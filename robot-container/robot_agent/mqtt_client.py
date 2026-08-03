"""paho-mqtt-backed implementation of MQTTClientInterface.

Bridges paho's callback-driven background thread (loop_start()) into the
agent's asyncio world: connect()/disconnect() are async so the event loop
can await them (with real exponential backoff instead of a blocking
time.sleep loop); publish()/subscribe() stay synchronous since they're just
fast local calls into paho's own outgoing queue.

Re-subscribes every topic on every (re)connect, not just the first one -
the broker forgets a client's subscriptions across reconnects, so skipping
this would mean commands silently stop arriving after any network blip.
"""
import asyncio
import json
import logging
from typing import Callable, Optional

import paho.mqtt.client as mqtt

from robot_agent.interfaces import MQTTClientInterface


class PahoMQTTClient(MQTTClientInterface):
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        client_id: str,
        keepalive: int = 30,
        logger: Optional[logging.Logger] = None,
    ):
        self._host = host
        self._port = port
        self._keepalive = keepalive
        self._logger = logger or logging.getLogger("robot_agent.mqtt_client")

        self._client = mqtt.Client(client_id=client_id)
        self._client.username_pw_set(username, password)
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._handle_connect
        self._client.on_disconnect = self._handle_disconnect
        self._client.on_message = self._handle_message

        self._connected = asyncio.Event()
        # topic -> (qos, callback), replayed on every (re)connect.
        self._subscriptions: dict[str, tuple[int, Callable[[dict], None]]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_will(self, topic: str, payload: str, qos: int = 1, retain: bool = True) -> None:
        self._client.will_set(topic, payload, qos=qos, retain=retain)

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
            self._logger.warning(
                "Timed out waiting for CONNACK - paho will keep retrying in the background"
            )

    async def disconnect(self) -> None:
        self._client.loop_stop()
        await asyncio.to_thread(self._client.disconnect)
        self._connected.clear()

    def publish(self, topic: str, payload: str, qos: int = 0, retain: bool = False) -> None:
        self._client.publish(topic, payload, qos=qos, retain=retain)

    def subscribe(self, topic: str, qos: int, callback: Callable[[dict], None]) -> None:
        self._subscriptions[topic] = (qos, callback)
        if self.is_connected:
            self._client.subscribe(topic, qos=qos)

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
        for topic, (qos, _callback) in self._subscriptions.items():
            client.subscribe(topic, qos=qos)
            self._logger.info(f"Re-subscribed to {topic}")

    def _handle_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        self._logger.warning(f"MQTT disconnected, rc={rc}")
        if self._loop:
            self._loop.call_soon_threadsafe(self._connected.clear)

    def _handle_message(self, client: mqtt.Client, userdata, msg) -> None:
        _qos, callback = self._subscriptions.get(msg.topic, (None, None))
        if callback is None:
            return
        try:
            payload = json.loads(msg.payload.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._logger.error(f"Malformed payload on {msg.topic}: {exc}")
            return
        try:
            callback(payload)
        except Exception:
            self._logger.exception(f"Error handling message on {msg.topic}")
