"""MQTTService — the only backend module that touches the broker.

Same rule as the real system (cloud-container/backend/app/mqtt/service.py):
every other module reaches the device through this one service and never
opens its own MQTT client. One connection, one place to add TLS and
credentials later.

The interesting mechanic, kept verbatim from the real implementation:
paho-mqtt runs its network loop on its own background thread, so its
callbacks do NOT fire on the asyncio event loop. Anything a callback wants
to do that touches async state has to be handed back across that boundary
with `call_soon_threadsafe`. Calling an async handler directly from a paho
callback is the classic bug here — it either does nothing or corrupts loop
state, depending on how unlucky you are.
"""
import asyncio
import json
import logging
from typing import Awaitable, Callable

import paho.mqtt.client as mqtt

from app.mqtt.topics import int_topic_wildcard, parse_topic, string_topic_wildcard

MessageHandler = Callable[[str, str, dict], Awaitable[None]]

logger = logging.getLogger("backend.mqtt")

# INTERN TASK (security): the real service caps payload size before calling
# json.loads(), because that parse runs on the single event loop serving
# every WebSocket client — a multi-megabyte payload stalls everyone. There
# is no cap here, and mosquitto.conf sets no message_size_limit either.


class MQTTService:
    def __init__(self, host: str, port: int) -> None:
        self._host = host
        self._port = port
        self._handlers: dict[str, list[MessageHandler]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._connected = False

        # INTERN TASK (security): no username_pw_set(), no tls_set(). The
        # real client configures both before connect() — TLS in particular
        # must be set up before the socket exists, or it silently does
        # nothing.
        self._client = mqtt.Client(client_id="demo-backend")
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    # ---- wiring ---------------------------------------------------------

    def on_message(self, kind: str, handler: MessageHandler) -> None:
        """Register a coroutine to run for every message of `kind`.

        Handlers are registered at startup in main.py, before connect(), so
        no message can arrive before there is something to receive it.
        """
        self._handlers.setdefault(kind, []).append(handler)

    @property
    def connected(self) -> bool:
        return self._connected

    # ---- lifecycle ------------------------------------------------------

    async def connect(self) -> None:
        self._loop = asyncio.get_running_loop()
        logger.info(f"connecting to broker at {self._host}:{self._port}")
        # connect_async + loop_start returns immediately and keeps retrying
        # in the background, so a broker that is still booting delays data
        # rather than killing backend startup.
        self._client.connect_async(self._host, self._port, keepalive=30)
        self._client.loop_start()

    async def disconnect(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()
        self._connected = False
        logger.info("disconnected from broker")

    def publish(self, topic: str, payload: dict) -> None:
        self._client.publish(topic, json.dumps(payload), qos=0)

    # ---- paho callbacks (background thread — not the event loop) --------

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc != 0:
            logger.error(f"broker refused the connection (rc={rc})")
            return
        self._connected = True
        # Re-subscribe on EVERY connect, not just the first. A broker forgets
        # a client's subscriptions across a reconnect, so skipping this means
        # data silently stops arriving after any network blip.
        for topic in (string_topic_wildcard(), int_topic_wildcard()):
            client.subscribe(topic, qos=0)
            logger.info(f"subscribed to {topic}")

    def _on_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        self._connected = False
        logger.warning(f"lost the broker connection (rc={rc}); paho will retry")

    def _on_message(self, client: mqtt.Client, userdata, message: mqtt.MQTTMessage) -> None:
        parsed = parse_topic(message.topic)
        if parsed is None:
            logger.debug(f"ignoring message on unrecognised topic {message.topic}")
            return
        device_id, kind = parsed

        handlers = self._handlers.get(kind)
        if not handlers:
            return

        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            logger.warning(f"dropping malformed payload on {message.topic}")
            return
        if not isinstance(payload, dict):
            logger.warning(f"dropping non-object payload on {message.topic}")
            return

        # The thread hand-off. `self._loop` was captured in connect(), which
        # ran on the event loop; scheduling the coroutine onto it here is
        # what makes it safe to await Redis and Postgres from a handler.
        if self._loop is None:
            return
        for handler in handlers:
            asyncio.run_coroutine_threadsafe(handler(device_id, kind, payload), self._loop)
