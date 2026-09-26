"""Regression tests for the input-size and input-shape limits added in
docs/security-findings.md (F2: oversized MQTT payloads, F4: unbounded and
unvalidated SDP).

Both findings were denial-of-service paths into the two components least
able to absorb one: the backend's single asyncio event loop, which serves
every robot and every dashboard, and GStreamer's C-based SDP parser on the
robot. Each test here fails if the corresponding guard is removed.

No live broker, Postgres, or Redis needed - these exercise the guard logic
and the Pydantic model directly.
"""
import json
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.models import WebRTCOfferRequest
from app.mqtt.service import MAX_PAYLOAD_BYTES, MQTTService

# Minimal SDP that satisfies the validator - a real browser offer is far
# longer, but these are the two properties the backend actually checks.
VALID_SDP = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"


# ── F2: oversized MQTT payloads must be dropped before json.loads() ──

@pytest.fixture
def service_with_recording_handler():
    service = MQTTService("localhost", 1883, "u", "p")
    received: list[tuple[str, dict]] = []

    async def handler(robot_id: str, payload: dict) -> None:
        received.append((robot_id, payload))

    service.on_message("telemetry", handler)
    # _handle_message bails out early when there's no loop; give it one so
    # the ONLY thing that can stop a message is the size guard itself.
    service._loop = Mock()
    return service, received


def _message(topic: str, payload: bytes) -> Mock:
    msg = Mock()
    msg.topic = topic
    msg.payload = payload
    return msg


def test_oversized_payload_is_dropped_before_parsing(service_with_recording_handler):
    service, _received = service_with_recording_handler
    oversized = json.dumps({"junk": "x" * (MAX_PAYLOAD_BYTES + 1000)}).encode()
    assert len(oversized) > MAX_PAYLOAD_BYTES

    service._handle_message(None, None, _message("robots/r1/telemetry", oversized))

    # Never scheduled onto the event loop - the guard runs before decode.
    service._loop.call_soon_threadsafe.assert_not_called()


def test_normal_sized_payload_still_flows(service_with_recording_handler):
    """The guard must not break the ordinary path - a real LiDAR scan is
    roughly 8 KB, far under the ceiling."""
    service, _received = service_with_recording_handler
    normal = json.dumps({"battery_percentage": 87.0}).encode()

    service._handle_message(None, None, _message("robots/r1/telemetry", normal))

    service._loop.call_soon_threadsafe.assert_called_once()


def test_payload_exactly_at_the_limit_is_accepted(service_with_recording_handler):
    """Boundary check - the limit is inclusive, so a message of exactly
    MAX_PAYLOAD_BYTES must still be delivered."""
    service, _received = service_with_recording_handler
    padding = MAX_PAYLOAD_BYTES - len(b'{"v": ""}')
    exact = b'{"v": "' + b"x" * padding + b'"}'
    exact = exact[:MAX_PAYLOAD_BYTES]
    assert len(exact) == MAX_PAYLOAD_BYTES

    service._handle_message(None, None, _message("robots/r1/telemetry", exact))

    service._loop.call_soon_threadsafe.assert_called_once()


def test_the_ceiling_is_bounded_and_sane():
    """Guards against someone 'fixing' a payload rejection by raising the
    limit to something that reintroduces the DoS."""
    assert 64_000 <= MAX_PAYLOAD_BYTES <= 1_048_576


# ── F4: SDP must be bounded and must look like an SDP offer ──

def test_valid_sdp_offer_is_accepted():
    request = WebRTCOfferRequest(sdp=VALID_SDP)

    assert request.sdp == VALID_SDP


def test_oversized_sdp_is_rejected():
    with pytest.raises(ValidationError):
        WebRTCOfferRequest(sdp="v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" + "a=x\r\n" * 100_000)


def test_sdp_not_starting_with_version_field_is_rejected():
    """RFC 4566 requires v=0 first. Anything else cannot be a valid offer,
    so it should never reach GStreamer's parser on the robot."""
    with pytest.raises(ValidationError):
        WebRTCOfferRequest(sdp="<html>not an sdp at all</html>\r\nm=video 9 x 96\r\n")


def test_sdp_without_a_video_section_is_rejected():
    with pytest.raises(ValidationError):
        WebRTCOfferRequest(sdp="v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n")


def test_empty_sdp_is_rejected():
    with pytest.raises(ValidationError):
        WebRTCOfferRequest(sdp="")
