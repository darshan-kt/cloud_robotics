"""In-memory video streamer test double - no real GStreamer/PyGObject
needed. VideoStreamer itself isn't unit-tested (GStreamer/PyGObject aren't
pip-installable into this lightweight test venv - see
robot-container/tests/README.md and docs/06-video-streaming.md), but
agent.py's own logic (does it push frames? does stream_video() report
status correctly?) still deserves coverage, which is what this enables."""
from robot_agent.models import CameraFrame


class FakeVideoStreamer:
    def __init__(self):
        self.pushed_frames: list[CameraFrame] = []
        self.start_calls = 0
        self.stop_calls = 0
        self.handled_offers: list[str] = []
        # Configurable per test - what handle_offer() returns, or raises.
        self.answer_sdp = "fake-answer-sdp"
        self.handle_offer_error: Exception | None = None

    def start(self) -> None:
        self.start_calls += 1

    def stop(self) -> None:
        self.stop_calls += 1

    def push_frame(self, frame: CameraFrame) -> None:
        self.pushed_frames.append(frame)

    def handle_offer(self, sdp: str) -> str:
        """See robot_agent/video_streamer.py's real handle_offer() -
        Milestone 8's MQTT signalling handler (agent.py's
        _on_camera_offer/_handle_camera_offer_blocking) is what this fakes
        out for agent.py's own unit tests."""
        self.handled_offers.append(sdp)
        if self.handle_offer_error is not None:
            raise self.handle_offer_error
        return self.answer_sdp

    @property
    def frames_pushed(self) -> int:
        return len(self.pushed_frames)

    @property
    def is_pipeline_ready(self) -> bool:
        return len(self.pushed_frames) > 0

    @property
    def rtp_packets_sent(self) -> int:
        # No real GStreamer pipeline here, so there's nothing to count -
        # 0 is the honest answer, same as a real pipeline that's never
        # actually sent media. See robot_agent/video_streamer.py's
        # rtp_packets_sent for what this represents for real.
        return 0
