"""MQTTService - the only backend module allowed to touch the broker (see
docs/00-overview.md's "why does the backend never talk to ROS2 directly"
and cloud-container/backend/README.md's module list). Every other module
(registry, fleet, sessions) reaches the robot fleet through this one
service, never through its own MQTT client.

Same paho-mqtt-background-thread-bridged-into-asyncio shape as
robot_agent/mqtt_client.py's PahoMQTTClient, for the same reason: paho's
callbacks fire on its own network thread, and anything they do that touches
asyncio state (registry updates, waking a WebSocket broadcaster) must be
handed back to the event loop via `call_soon_threadsafe` rather than called
directly.

Fleet-wide by design: subscribes with MQTT's `+` single-level wildcard
across every robot's status/telemetry/health/heartbeat, rather than one
robot at a time - matching the ACL's own `robots/+/...` read grant (see
cloud-container/mosquitto/aclfile) and letting the backend handle any
number of robots without code changes as robots are added.
"""
import asyncio
import json
import logging
from typing import Awaitable, Callable, Optional

import paho.mqtt.client as mqtt

from app.mqtt.topics import (
    camera_answer_topic_wildcard,
    camera_offer_topic,
    cmd_topic,
    health_topic_wildcard,
    heartbeat_topic_wildcard,
    parse_topic,
    status_topic_wildcard,
    telemetry_topic_wildcard,
)

MessageHandler = Callable[[str, dict], Awaitable[None]]


class MQTTService:
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        client_id: str = "backend",
        keepalive: int = 30,
        logger: Optional[logging.Logger] = None,
    ):
        self._host = host
        self._port = port
        self._keepalive = keepalive
        self._logger = logger or logging.getLogger("backend.mqtt.service")

        self._client = mqtt.Client(client_id=client_id)
        self._client.username_pw_set(username, password)
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._handle_connect
        self._client.on_disconnect = self._handle_disconnect
        self._client.on_message = self._handle_message

        self._connected = asyncio.Event()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # suffix ("status"/"telemetry"/"health"/"heartbeat") -> handlers,
        # each invoked as (robot_id, payload) for every matching message.
        self._handlers: dict[str, list[MessageHandler]] = {}

    def on_message(self, suffix: str, handler: MessageHandler) -> None:
        """Registers an async handler for every inbound message on
        robots/{any}/{suffix}. Called at composition time (see main.py) -
        e.g. the registry subscribes to "status"/"telemetry"/"health"/
        "heartbeat" to keep robot state current."""
        self._handlers.setdefault(suffix, []).append(handler)

    async def connect(self) -> None:
        self._loop = asyncio.get_running_loop()
        delay = 1
        while True:
            try:
                await asyncio.to_thread(self._client.connect, self._host, self._port, self._keepalive)
                self._client.loop_start()
                break
            except OSError as exc:
                self._logger.warning(f"Broker unreachable ({exc}), retrying in {delay}s")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)

        try:
            await asyncio.wait_for(self._connected.wait(), timeout=10)
        except asyncio.TimeoutError:
            self._logger.warning("Timed out waiting for CONNACK - paho will keep retrying in the background")

    async def disconnect(self) -> None:
        self._client.loop_stop()
        await asyncio.to_thread(self._client.disconnect)
        self._connected.clear()

    def publish_command(self, robot_id: str, command: str) -> None:
        """The ONLY thing the backend is trusted to originate on the fleet
        namespace - see docs/03-mqtt-layer.md on why telemetry/health/status
        are read-only for the backend. QoS 1: a dropped command matters."""
        payload = json.dumps({"command": command, "issued_at": _iso_now()})
        self._client.publish(cmd_topic(robot_id), payload, qos=1)

    def publish_camera_offer(self, robot_id: str, request_id: str, sdp: str) -> None:
        """The second (and last) thing the backend originates on the fleet
        namespace, alongside `cmd` - see aclfile's comment on why an SDP
        offer isn't the same risk category as writing telemetry/health/
        status. `request_id` lets webrtc/relay.py match this offer to the
        eventual answer on camera/answer, since MQTT itself has no
        request/response correlation - see docs/08-webrtc-signalling.md."""
        payload = json.dumps({"request_id": request_id, "sdp": sdp})
        self._client.publish(camera_offer_topic(robot_id), payload, qos=1)

    @property
    def is_connected(self) -> bool:
        return self._connected.is_set()

    # --- paho callbacks (run on paho's own background thread) ---
    def _handle_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc != 0:
            self._logger.error(f"MQTT connect failed, rc={rc}")
            return
        self._logger.info(f"MQTT connected to {self._host}:{self._port}")
        if self._loop:
            self._loop.call_soon_threadsafe(self._connected.set)
        for wildcard in (
            status_topic_wildcard(),
            telemetry_topic_wildcard(),
            health_topic_wildcard(),
            heartbeat_topic_wildcard(),
            camera_answer_topic_wildcard(),
        ):
            client.subscribe(wildcard, qos=1)
            self._logger.info(f"Re-subscribed to {wildcard}")

    def _handle_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        self._logger.warning(f"MQTT disconnected, rc={rc}")
        if self._loop:
            self._loop.call_soon_threadsafe(self._connected.clear)

    def _handle_message(self, client: mqtt.Client, userdata, msg) -> None:
        parsed = parse_topic(msg.topic)
        if parsed is None:
            return
        robot_id, suffix = parsed
        handlers = self._handlers.get(suffix)
        if not handlers:
            return
        try:
            payload = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._logger.error(f"Malformed payload on {msg.topic}: {exc}")
            return
        if self._loop is None:
            return
        for handler in handlers:
            self._loop.call_soon_threadsafe(self._dispatch, handler, robot_id, payload)

    def _dispatch(self, handler: MessageHandler, robot_id: str, payload: dict) -> None:
        """Runs ON the event loop (scheduled via call_soon_threadsafe from
        the paho thread) - safe to create a task here."""
        task = asyncio.create_task(handler(robot_id, payload))
        task.add_done_callback(self._log_handler_error)

    def _log_handler_error(self, task: asyncio.Task) -> None:
        exc = task.exception()
        if exc is not None:
            self._logger.exception("Error in MQTT message handler", exc_info=exc)


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
