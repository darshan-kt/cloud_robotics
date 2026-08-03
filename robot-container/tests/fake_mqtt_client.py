"""In-memory MQTTClientInterface test double - no real network or broker,
used to unit-test RobotCloudAgent in complete isolation."""
from typing import Callable

from robot_agent.interfaces import MQTTClientInterface


class FakeMQTTClient(MQTTClientInterface):
    def __init__(self):
        self.connected = False
        self.published: list[tuple[str, str, int, bool]] = []
        self.subscriptions: dict[str, tuple[int, Callable[[dict], None]]] = {}
        self.will = None
        self.connect_calls = 0
        self.disconnect_calls = 0

    def set_will(self, topic, payload, qos=1, retain=True):
        self.will = (topic, payload, qos, retain)

    async def connect(self):
        self.connect_calls += 1
        self.connected = True

    async def disconnect(self):
        self.disconnect_calls += 1
        self.connected = False

    def publish(self, topic, payload, qos=0, retain=False):
        self.published.append((topic, payload, qos, retain))

    def subscribe(self, topic, qos, callback):
        self.subscriptions[topic] = (qos, callback)

    @property
    def is_connected(self):
        return self.connected

    def simulate_incoming(self, topic: str, payload: dict) -> None:
        """Test helper: pretend a message arrived on `topic`."""
        _qos, callback = self.subscriptions[topic]
        callback(payload)
