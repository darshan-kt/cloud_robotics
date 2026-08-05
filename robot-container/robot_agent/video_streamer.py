"""GStreamer H264 -> WebRTC video pipeline (Milestone 6).

Camera frames arrive via push_frame(), called from RealROSAdapter's ROS2
subscription callback. One unified GStreamer pipeline does capture-side
format conversion, H264 encoding (x264enc), AND the WebRTC transport itself
(webrtcbin) - see docs/06-video-streaming.md for why this wasn't split
across GStreamer (encode) + a separate Python WebRTC library (transport):
that split turned out to have real technical friction, and this way
matches the spec's diagram literally (GStreamer feeds WebRTC directly).

Runs its own GLib MainLoop on a background thread - the same "own thread,
dispatch via stored state" shape as MockROSAdapter and RealROSAdapter, and
for the same reason: GStreamer's C-level event loop can't share a thread
with Python's asyncio loop.

Every interaction with the pipeline/webrtcbin - pushing frames from the
ROS2 callback thread, negotiating from an HTTP request thread - is
marshalled onto that SAME GLib main loop thread via GLib.idle_add(), never
called directly from whichever foreign thread triggered it. This isn't
optional tidiness: calling webrtcbin concurrently from two threads at once
(a frame push racing an SDP negotiation step) reproducibly segfaults on
this stack - confirmed by isolating it in a standalone repro before writing
this version. See docs/06-video-streaming.md for the debugging story.

The pipeline is built lazily, on the first camera frame, once the real
width/height/encoding are known, rather than guessing them upfront.
"""
import logging
import threading
from typing import Optional

import gi

# Order matters here and cost real debugging time to find: GstSdp MUST be
# require_version'd (and imported) before GstWebRTC. WebRTCSessionDescription
# embeds a GstSDPMessage* internally, and if PyGObject resolves GstWebRTC's
# typelib before GstSdp's, extracting a description from a Gst.Promise's
# reply structure silently degrades to a generic, useless GBoxed wrapper
# (`.sdp`/attribute access raises AttributeError) instead of the real,
# usable WebRTCSessionDescription object - see docs/06-video-streaming.md.
gi.require_version("Gst", "1.0")
gi.require_version("GstSdp", "1.0")
gi.require_version("GstWebRTC", "1.0")
from gi.repository import Gst, GLib, GstSdp, GstWebRTC  # noqa: E402

from robot_agent.models import CameraFrame
from robot_agent.sdp_utils import choose_offer_h264_payload_type, rewrite_answer_for_real_codec_match

# ROS2 sensor_msgs/Image encodings this pipeline knows how to map onto a
# GStreamer raw video format string. Extend as new camera configs show up.
_ENCODING_TO_GST_FORMAT = {
    "rgb8": "RGB",
    "bgr8": "BGR",
    "rgba8": "RGBA",
    "bgra8": "BGRA",
    "mono8": "GRAY8",
}


class VideoStreamer:
    def __init__(
        self,
        bitrate_kbps: int = 1000,
        framerate: int = 15,
        keyframe_interval: int = 30,
        stun_server: str = "stun://stun.l.google.com:19302",
        turn_server: str = "",
        logger: Optional[logging.Logger] = None,
    ):
        self._bitrate_kbps = bitrate_kbps
        self._framerate = framerate
        self._keyframe_interval = keyframe_interval
        self._stun_server = stun_server
        # Empty = disabled. See config.py's VideoConfig.turn_server and
        # docs/09-frontend.md for why this exists alongside stun_server.
        self._turn_server = turn_server
        self._logger = logger or logging.getLogger("robot_agent.video_streamer")

        Gst.init(None)

        self._loop = GLib.MainLoop()
        self._loop_thread = threading.Thread(target=self._loop.run, daemon=True, name="gst-mainloop")

        self._pipeline: Optional[Gst.Pipeline] = None
        self._appsrc = None
        self._payloader = None
        self._rtpcaps = None
        # No webrtcbin at all until the first offer arrives - and a fresh
        # one replaces it on every later offer too. See
        # _prepare_fresh_webrtcbin() for why "reuse one forever" doesn't
        # survive a real frontend reconnecting.
        self._webrtcbin = None
        self._presink = None
        self._build_lock = threading.Lock()
        self._frames_pushed = 0
        self._frames_dropped_during_negotiation = 0
        # Proof media is actually flowing, not just that signalling
        # succeeded - see _on_rtp_buffer() and docs/06-video-streaming.md.
        self._rtp_packets_sent = 0
        self._last_rtp_payload_type: Optional[int] = None
        # Set for the duration of handle_offer(). Continuous RTP media flow
        # (appsrc pushes) at the same time as ICE/DTLS negotiation reproducibly
        # crashed the underlying native stack on this platform - confirmed by
        # isolating it down to exactly this combination. Negotiation is a
        # one-time, few-second setup step, so briefly dropping frames while
        # it's in flight is a fair trade for not crashing. See
        # docs/06-video-streaming.md.
        self._negotiating = threading.Event()

    def start(self) -> None:
        self._loop_thread.start()
        self._logger.info("VideoStreamer GLib main loop started")

    def stop(self) -> None:
        if self._pipeline is not None:
            self._pipeline.set_state(Gst.State.NULL)
        if self._loop.is_running():
            self._loop.quit()
        self._loop_thread.join(timeout=2)

    # --- running work on the GLib main loop thread, from any other thread ---
    def _run_on_main_loop(self, fn, timeout: float = 10) -> None:
        """Schedules fn to run on the GLib main loop thread via idle_add,
        and blocks the CALLING thread until fn has finished executing there.
        This is what keeps every pipeline/webrtcbin touch serialized onto
        one thread, regardless of which thread called in."""
        done = threading.Event()
        error: list = []

        def on_idle():
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - re-raised on the caller's thread below
                error.append(exc)
            finally:
                done.set()
            return False  # GSourceFunc: False = don't call again

        GLib.idle_add(on_idle)
        if not done.wait(timeout=timeout):
            raise TimeoutError("Timed out waiting for GLib main loop to run scheduled work")
        if error:
            raise error[0]

    # --- frame ingestion (called from RealROSAdapter's ROS2 callback thread) ---
    def push_frame(self, frame: CameraFrame) -> None:
        with self._build_lock:
            if self._pipeline is None:
                self._run_on_main_loop(lambda: self._build_pipeline(frame.width, frame.height, frame.encoding))

        if self._negotiating.is_set():
            self._frames_dropped_during_negotiation += 1
            return

        self._run_on_main_loop(lambda: self._push_buffer(frame))
        self._frames_pushed += 1

    def _push_buffer(self, frame: CameraFrame) -> None:
        """Runs on the GLib main loop thread - not safe to call directly
        from any other thread.

        Rechecks self._negotiating even though push_frame() already checked
        it - deliberately, not redundantly. That first check runs on the
        ROS2 callback thread and only decides whether to *schedule* this
        call via GLib.idle_add(); _prepare_fresh_webrtcbin() (which sets
        _negotiating and can unlink rtpcaps's src pad mid-teardown) runs on
        THIS thread. A frame can pass the first check, get queued, and only
        actually run after negotiation has since started - a real,
        observed race (confirmed via repeated reconnect cycling: "not-
        linked" GStreamer pipeline errors after roughly a dozen-plus
        reconnects, intermittent, not every time - exactly the signature of
        a narrow scheduling window, not a deterministic bug). Rechecking
        here, on the only thread that also runs the teardown/relink, closes
        it for real instead of narrowing the window."""
        if self._negotiating.is_set():
            self._frames_dropped_during_negotiation += 1
            return
        buf = Gst.Buffer.new_wrapped(bytes(frame.data))
        retval = self._appsrc.emit("push-buffer", buf)
        if retval != Gst.FlowReturn.OK:
            self._logger.warning(f"appsrc push-buffer returned {retval}")

    @property
    def frames_pushed(self) -> int:
        return self._frames_pushed

    @property
    def is_pipeline_ready(self) -> bool:
        return self._pipeline is not None

    def _build_pipeline(self, width: int, height: int, encoding: str) -> None:
        """Runs on the GLib main loop thread (see push_frame) - not safe to
        call directly from any other thread.

        The encode chain (appsrc..rtph264pay) is built and started
        immediately - camera frames start flowing and getting encoded right
        away, well before any browser ever connects. It terminates in a
        throwaway fakesink; no webrtcbin exists yet at all. One is built
        fresh for every offer (see _prepare_fresh_webrtcbin(), called from
        handle_offer()) rather than being created here once - see that
        method's docstring for why "built once, reused forever" doesn't
        survive contact with a real frontend that can reconnect.
        """
        gst_format = _ENCODING_TO_GST_FORMAT.get(encoding)
        if gst_format is None:
            raise ValueError(f"Unsupported camera encoding '{encoding}' - no GStreamer format mapping")

        description = (
            f"appsrc name=src is-live=true format=time do-timestamp=true "
            f"caps=video/x-raw,format={gst_format},width={width},height={height},"
            f"framerate={self._framerate}/1 ! "
            f"videoconvert ! video/x-raw,format=I420 ! "
            f"x264enc tune=zerolatency speed-preset=ultrafast "
            f"bitrate={self._bitrate_kbps} key-int-max={self._keyframe_interval} ! "
            # level=3.1: a real negotiation point x264enc honors. Without
            # it, x264enc auto-selects a level from the input resolution
            # alone, which then doesn't match the level any real WebRTC
            # peer's offer actually proposes (commonly .../.../1f = level
            # 3.1).
            #
            # stream-format=byte-stream is the actual fix for this
            # milestone's whole codec-negotiation saga (see
            # docs/06-video-streaming.md): leaving it unset (this pipeline's
            # previous state) makes webrtcbin's create-answer fail to bind a
            # proper transceiver AT ALL - not a profile-level-id or
            # payload-type mismatch as first suspected (both turned out to
            # be red herrings, extensively verified) - it silently falls
            # back to an inert, unbound `a=inactive` answer regardless of
            # whether the actual caps would otherwise be a fine match.
            # Forcing stream-format to an explicit, unambiguous value
            # resolves it completely - confirmed on both this project's
            # shipped GStreamer (1.20.3) and a newer one (1.24.2), so this
            # is not a version-specific workaround.
            f"video/x-h264,profile=baseline,level=(string)3.1,stream-format=(string)byte-stream ! "
            f"rtph264pay name=pay config-interval=1 pt=96 ! "
            f"capsfilter name=rtpcaps caps=application/x-rtp,media=video,encoding-name=H264,payload=96 ! "
            f"fakesink name=presink"
        )
        self._logger.info(f"Building GStreamer pipeline for {width}x{height} ({encoding} -> {gst_format})")
        self._pipeline = Gst.parse_launch(description)
        self._appsrc = self._pipeline.get_by_name("src")
        self._payloader = self._pipeline.get_by_name("pay")
        self._rtpcaps = self._pipeline.get_by_name("rtpcaps")
        self._presink = self._pipeline.get_by_name("presink")

        # No webrtcbin yet - see _prepare_fresh_webrtcbin(), built fresh
        # per offer rather than once here.

        # Real, permanent observability for "is media actually flowing", not
        # just "did signalling succeed" - the two turned out to be different
        # questions the hard way (see docs/06-video-streaming.md). Counts
        # RTP packets the payloader actually emits, read off the raw RTP
        # header's payload-type byte so it also answers "which PT is really
        # on the wire" - not just trusting whatever property we last set.
        self._payloader.get_static_pad("src").add_probe(
            Gst.PadProbeType.BUFFER, self._on_rtp_buffer
        )

        bus = self._pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self._on_bus_message)

        self._pipeline.set_state(Gst.State.PLAYING)

    def _prepare_fresh_webrtcbin(self, pt: int) -> None:
        """Runs on the GLib main loop thread (see handle_offer) - not safe
        to call directly from any other thread.

        Builds a BRAND NEW webrtcbin for every single offer, discarding
        whatever webrtcbin (if any) answered the previous one. This
        replaced an earlier "build one webrtcbin, retarget its properties
        for any later offer" design (see git history and
        docs/06-video-streaming.md for that version's own story) that was
        correct for dev_signalling_server.py's one-shot verification but
        broke the moment Milestone 9's real frontend exercised it: a normal
        page reload, or navigating away from the Robot page and back,
        creates a brand new RTCPeerConnection and sends a brand new offer
        with fresh ICE credentials - and GStreamer's webrtcbin models
        exactly one PeerConnection internally. Calling set-remote-description
        again with a new offer on an already-negotiated webrtcbin doesn't
        establish an independent second connection; it silently corrupts
        the existing one's internal ICE agent state instead - confirmed by
        reproducing it directly: a first connection that was actively
        sending RTP (rtp_packets_sent climbing) went permanently silent the
        moment a second offer landed on the same webrtcbin, and the second
        browser's connection never progressed past `readyState: 0` either.
        See docs/09-frontend.md.

        This only supports one connected viewer at a time (multi-viewer
        fan-out is a documented non-goal, not silently broken - see
        docs/09-frontend.md) - it now correctly supports one viewer AT A
        TIME across the robot's whole process lifetime, tearing down and
        replacing the previous connection instead of trying to reuse it.

        Sets the payload-type number to match the offer (RFC 3264 requires
        the answerer to select from the offer's own numbering - see
        choose_offer_h264_payload_type) and the explicit stream-format
        caps this whole pipeline depends on (see _build_pipeline's own
        docstring) BEFORE the new webrtcbin's request pad is linked -
        correct caps on the very first link of a given webrtcbin is what
        actually matters; a later property-change retarget on an
        already-linked pad does not reliably reach webrtcbin's internal
        negotiation state the same way, which is exactly why this always
        links a fresh element rather than patching the old one in place.
        """
        self._payloader.set_property("pt", pt)
        self._rtpcaps.set_property(
            "caps", Gst.Caps.from_string(f"application/x-rtp,media=video,encoding-name=H264,payload={pt}")
        )

        rtpcaps_src = self._rtpcaps.get_static_pad("src")

        # Block this pad before unlinking it - the standard GStreamer
        # pattern for reconfiguring a PLAYING pipeline (see GStreamer's own
        # "Dynamic Pipelines" tutorial), and load-bearing here, not
        # defensive boilerplate: appsrc streams on its OWN internal thread,
        # independent of the GLib main loop this method itself runs on
        # (see _run_on_main_loop) - a buffer already past appsrc's internal
        # queue can arrive at this exact pad mid-unlink with nothing to
        # write into, which is exactly the "streaming stopped, reason
        # not-linked" GStreamer pipeline error this project hit under
        # rapid reconnect cycling (confirmed by a dedicated stress test:
        # ~15 reconnects in quick succession, intermittent - the signature
        # of a real scheduling race, not a deterministic bug). Blocking
        # first guarantees no buffer is in flight through this pad for the
        # whole unlink/relink below, closing the race instead of narrowing
        # its window. `blocked.wait()` is timeout-bounded rather than
        # unconditional, matching every other wait in this file (see
        # _wait_promise, _run_on_main_loop) - if the pipeline is
        # momentarily idle and never delivers a blocking buffer, proceeding
        # anyway after a short timeout is still correct (there's nothing
        # in flight to race against).
        blocked = threading.Event()

        def _on_blocked(pad: Gst.Pad, info: Gst.PadProbeInfo) -> Gst.PadProbeReturn:
            blocked.set()
            return Gst.PadProbeReturn.OK

        probe_id = rtpcaps_src.add_probe(Gst.PadProbeType.BLOCK_DOWNSTREAM, _on_blocked)
        try:
            if not blocked.wait(timeout=1):
                self._logger.warning(
                    "Timed out waiting for the encode chain to quiesce before relinking - proceeding anyway"
                )

            old_sink_pad = rtpcaps_src.get_peer()
            if old_sink_pad is not None:
                rtpcaps_src.unlink(old_sink_pad)

            if self._webrtcbin is not None:
                self._logger.info("New WebRTC offer arrived - tearing down the previous webrtcbin before answering")
                old_webrtcbin = self._webrtcbin
                self._webrtcbin = None
                old_webrtcbin.set_state(Gst.State.NULL)
                self._pipeline.remove(old_webrtcbin)
            elif self._presink is not None:
                # Very first offer ever - what rtpcaps was linked to was
                # still the startup fakesink (see _build_pipeline), not a
                # previous webrtcbin.
                self._pipeline.remove(self._presink)
                self._presink.set_state(Gst.State.NULL)
                self._presink = None

            webrtcbin = Gst.ElementFactory.make("webrtcbin", None)
            webrtcbin.set_property("bundle-policy", "max-bundle")
            webrtcbin.set_property("stun-server", self._stun_server)
            if self._turn_server:
                webrtcbin.set_property("turn-server", self._turn_server)
            self._pipeline.add(webrtcbin)
            webrtcbin.sync_state_with_parent()

            sink_pad = webrtcbin.get_request_pad("sink_%u")
            link_result = rtpcaps_src.link(sink_pad)
            if link_result != Gst.PadLinkReturn.OK:
                raise RuntimeError(f"Failed to link encode chain into the fresh webrtcbin: {link_result}")

            self._webrtcbin = webrtcbin
            self._logger.info(f"Linked a fresh webrtcbin for this offer, at payload type {pt}")
        finally:
            # Always unblock, even on failure - a probe left in place would
            # permanently wedge the encode chain, which is strictly worse
            # than the race it exists to prevent.
            rtpcaps_src.remove_probe(probe_id)

    def _on_rtp_buffer(self, pad: Gst.Pad, info: Gst.PadProbeInfo) -> Gst.PadProbeReturn:
        """Runs on GStreamer's own streaming thread (NOT the GLib main loop
        thread this file otherwise marshals everything onto) - deliberately
        kept to a plain counter increment and a raw byte read, nothing that
        touches webrtcbin or anything derived from a Promise, to stay clear
        of the concurrency hazard documented in the module docstring.

        This pad sits upstream of the deferred webrtcbin link (see
        _prepare_fresh_webrtcbin) - before the first offer arrives, buffers
        still flow through it toward the throwaway fakesink, which isn't
        "media flowing to a peer" and shouldn't count as such. Gated on
        self._webrtcbin being set so the metric keeps meaning what it says."""
        if self._webrtcbin is None:
            return Gst.PadProbeReturn.OK
        self._rtp_packets_sent += 1
        buf = info.get_buffer()
        ok, mapinfo = buf.map(Gst.MapFlags.READ)
        if ok and len(mapinfo.data) >= 2:
            self._last_rtp_payload_type = mapinfo.data[1] & 0x7F
            buf.unmap(mapinfo)
        return Gst.PadProbeReturn.OK

    @property
    def rtp_packets_sent(self) -> int:
        return self._rtp_packets_sent

    @property
    def last_rtp_payload_type(self) -> Optional[int]:
        return self._last_rtp_payload_type

    def _get_negotiated_profile_level_id(self) -> Optional[str]:
        """Runs on the GLib main loop thread. Reads the profile-level-id our
        OWN encoder actually produced, straight off the payloader's current
        src caps (derived from the real H264 SPS, not guessed) - used to
        build an honest fmtp line in rewrite_answer_for_real_codec_match()
        rather than echoing a value we don't actually emit."""
        caps = self._payloader.get_static_pad("src").get_current_caps()
        if caps is None or caps.get_size() == 0:
            return None
        return caps.get_structure(0).get_string("profile-level-id")

    def _on_bus_message(self, bus: Gst.Bus, message: Gst.Message) -> None:
        if message.type == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            self._logger.error(f"GStreamer pipeline error: {err} ({debug})")
        elif message.type == Gst.MessageType.EOS:
            self._logger.warning("GStreamer pipeline reached EOS")
        elif message.type == Gst.MessageType.WARNING:
            warn, debug = message.parse_warning()
            self._logger.warning(f"GStreamer pipeline warning: {warn} ({debug})")

    # --- WebRTC signalling (called by whatever transport carries offers -
    # dev_signalling_server.py today, MQTT via the backend in Milestone 8) ---
    def handle_offer(self, sdp_text: str) -> str:
        """Blocking - safe to call from any plain (non-asyncio) thread, such
        as a ThreadingHTTPServer request thread. Every actual webrtcbin
        interaction is marshalled onto the GLib main loop thread via
        _run_on_main_loop() - see the module docstring for why that's not
        optional. Non-trickle: waits for ICE gathering to finish before
        returning, so the answer's SDP already contains every local
        candidate and the caller doesn't need a second channel for
        trickled candidates - see docs/06-video-streaming.md."""
        if self._pipeline is None:
            raise RuntimeError("No camera frames received yet - pipeline not built")

        self._negotiating.set()
        # Objects that must outlive the specific line that created them -
        # e.g. a Promise's reply Structure, needed for as long as a boxed
        # value extracted from it is still in use. See the comment at
        # _extract_answer below for why this matters here.
        keep_alive: list = []
        try:
            offer_pt = choose_offer_h264_payload_type(sdp_text)
            if offer_pt is None:
                raise RuntimeError("Offer contains no H264 payload type - nothing this pipeline can answer")
            self._run_on_main_loop(lambda: self._prepare_fresh_webrtcbin(offer_pt))

            _ok, sdpmsg = GstSdp.SDPMessage.new()
            GstSdp.sdp_message_parse_buffer(sdp_text.encode(), sdpmsg)
            offer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.OFFER, sdpmsg)

            remote_promise = Gst.Promise.new()
            self._run_on_main_loop(lambda: self._webrtcbin.emit("set-remote-description", offer, remote_promise))
            result = self._wait_promise(remote_promise, "set-remote-description")
            if result != Gst.PromiseResult.REPLIED:
                raise RuntimeError(f"set-remote-description did not complete: {result}")

            answer_promise = Gst.Promise.new()
            self._run_on_main_loop(lambda: self._webrtcbin.emit("create-answer", None, answer_promise))
            result = self._wait_promise(answer_promise, "create-answer")
            if result != Gst.PromiseResult.REPLIED:
                raise RuntimeError(f"create-answer did not complete: {result}")

            # get_value("answer") and .sdp.as_text() MUST both run inside the
            # same idle callback, on the GLib main loop thread, and `reply`
            # (the Promise's reply Structure) must stay alive for as long as
            # `answer` - derived from it - is still in use, which includes
            # set-local-description below. get_value() on a GstStructure
            # hands back a boxed value that borrows rather than duplicates
            # its source data, so letting `reply` go out of scope (or
            # touching `answer`'s internals from a different thread) leaves
            # a dangling GstSDPMessage* - this reproducibly segfaulted
            # inside libgstsdp, isolated via kernel segfault logs and
            # incremental logging. See docs/06-video-streaming.md for the
            # full debugging story. keep_alive holds `reply` at
            # handle_offer's own scope so it outlives this callback.
            answer_sdp_holder = []
            profile_level_id_holder = []

            def _extract_answer():
                reply = answer_promise.get_reply()
                keep_alive.append(reply)
                answer_obj = reply.get_value("answer")
                answer_sdp_holder.append(answer_obj.sdp.as_text())
                profile_level_id_holder.append(self._get_negotiated_profile_level_id())

            self._run_on_main_loop(_extract_answer)
            answer_sdp_text = answer_sdp_holder[0]

            # create-answer's own output isn't trustworthy as-is here - see
            # rewrite_answer_for_real_codec_match() for exactly what's wrong
            # with it and why this is safe to hand to set-local-description
            # instead of the untouched auto-generated answer.
            rewritten_sdp_text = rewrite_answer_for_real_codec_match(
                answer_sdp_text, offer_pt, profile_level_id_holder[0]
            )
            if rewritten_sdp_text != answer_sdp_text:
                self._logger.info(
                    "create-answer produced an inactive/mismatched m-line - "
                    "rewriting it to an active H264 answer before "
                    "set-local-description (see docs/06-video-streaming.md)"
                )
            _ok2, rewritten_sdpmsg = GstSdp.SDPMessage.new()
            GstSdp.sdp_message_parse_buffer(rewritten_sdp_text.encode(), rewritten_sdpmsg)
            rewritten_answer = GstWebRTC.WebRTCSessionDescription.new(
                GstWebRTC.WebRTCSDPType.ANSWER, rewritten_sdpmsg
            )

            local_promise = Gst.Promise.new()
            self._run_on_main_loop(
                lambda: self._webrtcbin.emit("set-local-description", rewritten_answer, local_promise)
            )
            result = self._wait_promise(local_promise, "set-local-description")
            if result != Gst.PromiseResult.REPLIED:
                raise RuntimeError(f"set-local-description did not complete: {result}")

            self._wait_for_ice_gathering_complete(timeout=10)

            # Same rule as the answer extraction above: read the property
            # AND call .sdp.as_text() in the same idle callback, never carry
            # the boxed description itself back to the caller thread.
            local_desc_text_holder = []
            local_desc_is_none_holder = []

            def _extract_local_desc():
                local_desc = self._webrtcbin.get_property("local-description")
                local_desc_is_none_holder.append(local_desc is None)
                if local_desc is not None:
                    local_desc_text_holder.append(local_desc.sdp.as_text())

            self._run_on_main_loop(_extract_local_desc)
            if local_desc_is_none_holder[0]:
                self._logger.warning(
                    "local-description was null after gathering - returning the rewritten answer as first set"
                )
                return rewritten_sdp_text
            return local_desc_text_holder[0]
        finally:
            self._negotiating.clear()
            if self._frames_dropped_during_negotiation:
                self._logger.info(
                    f"Dropped {self._frames_dropped_during_negotiation} camera frames during negotiation"
                )
                self._frames_dropped_during_negotiation = 0

    def _wait_promise(self, promise: Gst.Promise, label: str, timeout: float = 10) -> Gst.PromiseResult:
        """Gst.Promise.wait() itself takes no timeout and can block forever
        if something never resolves - this bounds it from the outside so a
        stuck negotiation can't hang the request (and this container's only
        HTTP worker thread for it) indefinitely."""
        result_holder = {}

        def waiter() -> None:
            result_holder["result"] = promise.wait()

        thread = threading.Thread(target=waiter, daemon=True, name=f"promise-wait-{label}")
        thread.start()
        thread.join(timeout=timeout)
        if "result" not in result_holder:
            self._logger.error(f"{label}: Gst.Promise never resolved within {timeout}s")
            raise TimeoutError(f"{label} timed out waiting on Gst.Promise")
        return result_holder["result"]

    def _wait_for_ice_gathering_complete(self, timeout: float) -> None:
        state_holder = []
        self._run_on_main_loop(
            lambda: state_holder.append(self._webrtcbin.get_property("ice-gathering-state"))
        )
        if state_holder[0] == GstWebRTC.WebRTCICEGatheringState.COMPLETE:
            return

        done = threading.Event()

        def on_notify(element: Gst.Element, _pspec) -> None:
            if element.get_property("ice-gathering-state") == GstWebRTC.WebRTCICEGatheringState.COMPLETE:
                done.set()

        handler_id_holder = []
        self._run_on_main_loop(
            lambda: handler_id_holder.append(self._webrtcbin.connect("notify::ice-gathering-state", on_notify))
        )
        try:
            if not done.wait(timeout=timeout):
                self._logger.warning("Timed out waiting for ICE gathering to complete - answering anyway")
        finally:
            self._run_on_main_loop(lambda: self._webrtcbin.disconnect(handler_id_holder[0]))
