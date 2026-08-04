"""WebRTCSignallingRelay - shuttles an SDP offer/answer between a browser
and a robot over MQTT (Milestone 8), replacing the robot's throwaway
dev_signalling_server.py entirely. Never touches video bytes - only the
SDP text, matching docs/00-overview.md's "FastAPI's only role in video is
signalling" rule.

MQTT has no built-in request/response correlation (unlike, say, MQTT 5's
response-topic/correlation-data properties - this project targets plain
MQTT 3.1.1, see docs/03-mqtt-layer.md), so this module builds the smallest
version of that itself: a `request_id` travels with the offer and is
echoed back with the answer, and an `asyncio.Future` keyed by that id is
how the coroutine that published the offer gets woken up when the matching
answer arrives - the same shape a real RPC-over-pubsub layer would use,
just without a library for it.
"""
import asyncio
import logging
import uuid
from typing import Optional

from app.mqtt.service import MQTTService


class WebRTCRelayTimeoutError(Exception):
    """The robot never answered within the timeout - offline, or its own
    VideoStreamer.handle_offer() got stuck (see docs/06-video-streaming.md's
    own discussion of what can go wrong there)."""


class WebRTCSignallingRelay:
    def __init__(self, mqtt: MQTTService, logger: Optional[logging.Logger] = None):
        self._mqtt = mqtt
        self._logger = logger or logging.getLogger("backend.webrtc.relay")
        self._pending: dict[str, asyncio.Future] = {}

    async def relay_offer(self, robot_id: str, sdp: str, timeout: float = 20) -> str:
        """Publishes the offer, waits for the matching answer, returns its
        SDP text. Raises WebRTCRelayTimeoutError if nothing matching
        arrives in time - always cleans up its pending Future either way,
        so a timed-out request can never be resolved late by a
        stray/delayed answer."""
        request_id = str(uuid.uuid4())
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            self._mqtt.publish_camera_offer(robot_id, request_id, sdp)
            self._logger.info(f"Relayed WebRTC offer to {robot_id} (request_id={request_id})")
            try:
                return await asyncio.wait_for(future, timeout=timeout)
            except asyncio.TimeoutError:
                raise WebRTCRelayTimeoutError(
                    f"{robot_id} did not answer the WebRTC offer within {timeout}s"
                )
        finally:
            self._pending.pop(request_id, None)

    async def handle_answer(self, robot_id: str, payload: dict) -> None:
        """Registered as an MQTTService message handler for camera/answer
        (see main.py) - never called directly."""
        request_id = payload.get("request_id")
        sdp = payload.get("sdp")
        future = self._pending.get(request_id) if request_id else None
        if future is None:
            # Not necessarily an error - a request that already timed out
            # (and was popped) can still have its answer arrive late.
            self._logger.warning(
                f"Received a WebRTC answer from {robot_id} with no matching pending "
                f"request (request_id={request_id}) - likely arrived after timeout"
            )
            return
        if not future.done():
            future.set_result(sdp)
