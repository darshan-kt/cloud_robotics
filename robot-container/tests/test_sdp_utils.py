"""Unit tests for the SDP text logic behind Milestone 6's codec-negotiation
fix (see docs/06-video-streaming.md). Deliberately pure-Python/dependency-
free (robot_agent/sdp_utils.py has no gi/GStreamer import), unlike
video_streamer.py itself - see tests/fake_video_streamer.py for why that
one isn't unit-tested directly.

The offer/answer fragments below are trimmed excerpts of REAL SDP captured
from an actual Chrome browser negotiating with this project's GStreamer
pipeline (see docs/06-video-streaming.md) - not hand-invented syntax."""
from robot_agent.sdp_utils import choose_offer_h264_payload_type, rewrite_answer_for_real_codec_match

# Trimmed from a real Chrome offer: VP8 at the conventional low PT (96),
# H264 at several dynamic PTs - packetization-mode 0 and 1 variants of
# both the 'baseline' (42...) and 'main' (4d...) profile families.
REAL_CHROME_OFFER = """\
v=0
o=- 2974052934923684340 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=video 28241 UDP/TLS/RTP/SAVPF 96 103 107 109 115 117
c=IN IP4 87.52.109.227
a=mid:0
a=recvonly
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 nack pli
a=rtpmap:103 H264/90000
a=rtcp-fb:103 nack pli
a=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f
a=rtpmap:107 H264/90000
a=rtcp-fb:107 nack pli
a=fmtp:107 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f
a=rtpmap:109 H264/90000
a=rtcp-fb:109 nack pli
a=fmtp:109 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:117 H264/90000
a=rtcp-fb:117 nack pli
a=fmtp:117 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f
"""

# webrtcbin's real create-answer output against the offer above, before the
# fix: always echoes the offer's first codec (VP8@96), marked inactive,
# regardless of what our own H264 pad actually negotiated.
REAL_AUTO_ANSWER = """\
v=0
o=- 2974052934923684340 2 IN IP4 0.0.0.0
s=-
t=0 0
a=group:BUNDLE 0
m=video 9 UDP/TLS/RTP/SAVPF 96
c=IN IP4 0.0.0.0
a=mid:0
a=setup:active
a=rtpmap:96 VP8/90000
a=rtcp-fb:96 nack pli
a=rtcp-fb:96 ccm fir
a=inactive
a=fingerprint:sha-256 AB:CD
"""


def test_chooses_packetization_mode_1_baseline_family_over_alternatives():
    # 103 (mode=1, baseline/42) beats 107 (mode=0, baseline/42),
    # 109 (mode=1, but 42e01f is still baseline-family so it's a legal
    # alternative - either 103 or 109 is an acceptable pick) and
    # 117 (mode=1, but 'main'/4d - worse family, our encoder can't do main).
    chosen = choose_offer_h264_payload_type(REAL_CHROME_OFFER)
    assert chosen in (103, 109)


def test_prefers_mode_1_over_mode_0_within_same_profile_family():
    offer = """\
m=video 9 UDP/TLS/RTP/SAVPF 107 103
a=rtpmap:107 H264/90000
a=fmtp:107 packetization-mode=0;profile-level-id=42001f
a=rtpmap:103 H264/90000
a=fmtp:103 packetization-mode=1;profile-level-id=42001f
"""
    assert choose_offer_h264_payload_type(offer) == 103


def test_returns_none_when_offer_has_no_h264():
    offer = """\
m=video 9 UDP/TLS/RTP/SAVPF 96 98
a=rtpmap:96 VP8/90000
a=rtpmap:98 VP9/90000
"""
    assert choose_offer_h264_payload_type(offer) is None


def test_rewrite_flips_inactive_vp8_answer_to_active_h264():
    rewritten = rewrite_answer_for_real_codec_match(REAL_AUTO_ANSWER, pt=103, profile_level_id="42c01f")

    assert "m=video 9 UDP/TLS/RTP/SAVPF 103" in rewritten
    assert "a=rtpmap:103 H264/90000" in rewritten
    assert "a=rtcp-fb:103 nack pli" in rewritten
    assert "a=rtcp-fb:103 ccm fir" in rewritten
    assert "a=inactive" not in rewritten
    assert "a=sendonly" in rewritten
    assert "a=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42c01f" in rewritten
    # Untouched fields must survive the rewrite unchanged.
    assert "a=fingerprint:sha-256 AB:CD" in rewritten
    assert "a=setup:active" in rewritten


def test_rewrite_omits_profile_level_id_when_none_available():
    rewritten = rewrite_answer_for_real_codec_match(REAL_AUTO_ANSWER, pt=103, profile_level_id=None)

    assert "a=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1" in rewritten
    assert "profile-level-id" not in rewritten.split("a=fmtp:103")[1].split("\n")[0]


def test_rewrite_is_a_noop_when_answer_is_already_correct():
    already_good = """\
m=video 9 UDP/TLS/RTP/SAVPF 103
a=rtpmap:103 H264/90000
a=sendonly
a=fmtp:103 profile-level-id=42c01f
"""
    assert rewrite_answer_for_real_codec_match(already_good, pt=103, profile_level_id="42c01f") == already_good


def test_rewrite_raises_on_unparseable_answer():
    import pytest

    with pytest.raises(ValueError):
        rewrite_answer_for_real_codec_match("no m-line here", pt=103, profile_level_id="42c01f")
