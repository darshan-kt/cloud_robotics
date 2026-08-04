"""Pure SDP text helpers for the WebRTC H264 codec-negotiation fix
(Milestone 6). Deliberately dependency-free (stdlib `re` only, no
GStreamer/PyGObject) so this logic - the trickiest part of the whole
negotiation gap, see docs/06-video-streaming.md - is actually unit-testable
in the lightweight test venv, unlike video_streamer.py itself (GStreamer/
PyGObject aren't pip-installable there - see tests/fake_video_streamer.py).
"""
import re
from typing import Optional

_RTPMAP_RE = re.compile(r"^a=rtpmap:(\d+)\s+([\w-]+)/", re.MULTILINE)
_FMTP_RE = re.compile(r"^a=fmtp:(\d+)\s+(.+)$", re.MULTILINE)
_MLINE_RE = re.compile(r"^m=video (\S+) (\S+) (\d+)\s*$", re.MULTILINE)


def choose_offer_h264_payload_type(sdp_text: str) -> Optional[int]:
    """Picks which of the OFFER's own H264 payload-type numbers our answer
    should use. Browsers assign H264 dynamic PT numbers of their own
    choosing (VP8/VP9/AV1 usually take the low, conventional numbers like
    96-101) - our pipeline's own hardcoded pt=96 essentially never
    coincides with one of them. Per RFC 3264, the answerer must select
    from the offer's own PT numbers for a codec, not invent its own, so
    this has to be read out of the offer text before answering. See the
    comment above rtph264pay in video_streamer.py's _build_pipeline() and
    docs/06-video-streaming.md.

    Preference: packetization-mode=1 (what rtph264pay produces) and a
    profile-level-id in the '42' (baseline) family, since that is the
    profile family x264enc's zerolatency baseline output actually belongs
    to (see docs/06-video-streaming.md for why the exact constraint-flags
    byte still won't match) - offered 'main'/'high444' entries are a
    strictly worse fallback since our encoder can't approximate those at
    all. Falls back to any H264 entry, then to None if the offer has none.
    """
    h264_pts = [pt for pt, name in _RTPMAP_RE.findall(sdp_text) if name == "H264"]
    if not h264_pts:
        return None

    fmtp_by_pt = dict(_FMTP_RE.findall(sdp_text))

    def score(pt: str) -> tuple:
        fmtp = fmtp_by_pt.get(pt, "")
        is_mode1 = "packetization-mode=1" in fmtp
        is_baseline_family = re.search(r"profile-level-id=42", fmtp) is not None
        return (is_mode1, is_baseline_family)

    best = max(h264_pts, key=score)
    return int(best)


def rewrite_answer_for_real_codec_match(
    answer_sdp_text: str, pt: int, profile_level_id: Optional[str]
) -> str:
    """webrtcbin's own create-answer (this GStreamer 1.20.3 build) doesn't
    retarget the RTP payload-type number to one of the OFFER's own H264
    entries, and doesn't recognize our real H264 caps as a match even once
    the payload type IS retargeted (both confirmed directly, standalone,
    against a real offer - see docs/06-video-streaming.md) - it always
    echoes back whichever codec its own m-line default happened to be
    (in practice, the offer's first-listed codec), marked a=inactive.

    Rather than trust that output, this hand-edits it: point the m-line's
    payload-type list, its rtpmap, and its rtcp-fb entries at the OFFER's
    own H264 payload-type number (see choose_offer_h264_payload_type -
    RFC 3264 requires the answer to select from the offer's own numbering,
    not invent one), replace a=inactive with a=sendonly, and add an fmtp
    line carrying OUR actual negotiated profile-level-id (not the offer's -
    x264enc's zerolatency baseline output can't be forced to match it
    exactly, see video_streamer.py's _build_pipeline; real H264 decoders
    read the profile from the bitstream's own SPS regardless of what fmtp
    claims, so this is honest rather than a workaround-on-top-of-a-workaround).

    Confirmed directly (see docs/06-video-streaming.md) that
    set-local-description ACCEPTS a description edited this way and
    reconfigures webrtcbin's own transceiver state to match (direction
    becomes sendonly, local-description reflects the new payload type) -
    this isn't just cosmetic text handed to the remote peer.
    """
    match = _MLINE_RE.search(answer_sdp_text)
    if match is None:
        raise ValueError("create-answer's SDP had no parseable m=video line to rewrite")
    port, proto, current_pt = match.group(1), match.group(2), match.group(3)

    if current_pt == str(pt) and "a=inactive" not in answer_sdp_text:
        return answer_sdp_text  # already active and already using the right PT - nothing to fix

    rewritten = answer_sdp_text.replace(
        f"m=video {port} {proto} {current_pt}", f"m=video {port} {proto} {pt}"
    )
    rewritten = re.sub(rf"a=rtpmap:{current_pt} \S+", f"a=rtpmap:{pt} H264/90000", rewritten)
    rewritten = re.sub(rf"a=rtcp-fb:{current_pt} ", f"a=rtcp-fb:{pt} ", rewritten)
    fmtp = f"a=fmtp:{pt} level-asymmetry-allowed=1;packetization-mode=1"
    if profile_level_id:
        fmtp += f";profile-level-id={profile_level_id}"
    rewritten = rewritten.replace("a=inactive", f"a=sendonly\r\n{fmtp}")
    return rewritten
