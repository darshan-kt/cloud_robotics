"""paho-mqtt client for the device side.

Same shape as robot-container/robot_agent/mqtt_client.py, minus the TLS and
credential handling that file exists to configure.

The one mechanic worth understanding before changing anything here:
paho runs its network loop on a background thread, so `on_connect` and
`on_message` do NOT fire on the asyncio event loop. `publish()` is safe to
call from either side because it only appends to paho's own outgoing queue,
but anything a callback does that touches async state must be handed back
to the loop — see `_on_message` below.
"""
import asyncio
import json
import logging
from typing import Awaitable, Callable

import paho.mqtt.client as mqtt

logger = logging.getLogger("agent.mqtt")

CommandHandler = Callable[[dict], Awaitable[None]]


class MqttClient:
    def __init__(self, host: str, port: int, client_id: str) -> None:
        self._host = host
        self._port = port
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscriptions: dict[str, CommandHandler] = {}
        self._connected = False

        # INTERN TASK (security): no username_pw_set(), no tls_set(). The
        # real client takes both, and TLS must be configured BEFORE connect()
        # — paho applies it when the socket is created, so calling tls_set()
        # afterwards silently does nothing.
        self._client = mqtt.Client(client_id=client_id)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    @property
    def connected(self) -> bool:
        return self._connected

    def subscribe(self, topic: str, handler: CommandHandler) -> None:
        """Register before connect(); re-applied on every reconnect."""
        self._subscriptions[topic] = handler

    async def connect(self) -> None:
        self._loop = asyncio.get_running_loop()
        logger.info(f"connecting to broker at {self._host}:{self._port}")
        # connect_async keeps retrying in the background, so a broker that
        # is still starting delays the first publish instead of killing the
        # agent.
        self._client.connect_async(self._host, self._port, keepalive=30)
        self._client.loop_start()

    async def disconnect(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()
        self._connected = False

    def publish(self, topic: str, payload: dict) -> None:
        """QoS 0: fire and forget.

        Correct for a once-per-second readout — if one message is lost,
        another is a second behind it, and a redelivered stale value is
        worse than a missing one. A command channel would want QoS 1.
        """
        self._client.publish(topic, json.dumps(payload), qos=0)

    # ---- paho callbacks (background thread) ------------------------------

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc != 0:
            logger.error(f"broker refused the connection (rc={rc})")
            return
        self._connected = True
        logger.info("connected to broker")
        # Re-subscribe on every connect: the broker forgets a client's
        # subscriptions across a reconnect, so skipping this means commands
        # silently stop arriving after any network blip.
        for topic in self._subscriptions:
            client.subscribe(topic, qos=0)
            logger.info(f"subscribed to {topic}")

    def _on_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        self._connected = False
        logger.warning(f"lost the broker connection (rc={rc}); paho will retry")

    def _on_message(self, client: mqtt.Client, userdata, message: mqtt.MQTTMessage) -> None:
        handler = self._subscriptions.get(message.topic)
        if handler is None or self._loop is None:
            return
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            logger.warning(f"dropping malformed command on {message.topic}")
            return
        # The thread hand-off — never call an async handler directly here.
        asyncio.run_coroutine_threadsafe(handler(payload), self._loop)
