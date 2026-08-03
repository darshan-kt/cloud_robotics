"""Interfaces the agent depends on. Concrete implementations are injected
at composition time (see main.py) - the agent itself never constructs them.

ROSAdapter: today, mock_ros_adapter.py's MockROSAdapter - it actually runs
in production until Milestone 5 replaces it with ros_ws/'s real rclpy-backed
implementation via a one-line change in main.py. Nothing in agent.py needs
to know that happened. This is exactly why robot_agent/ must never import
rclpy: doing so would tie this interface's only consumer to one
implementation, defeating the point of having the interface at all.

MQTTClientInterface: today, mqtt_client.py's PahoMQTTClient. Exists mainly
so tests can inject an in-memory fake instead of a real broker connection -
see robot-container/tests/fake_mqtt_client.py.
"""
from abc import ABC, abstractmethod
from typing import Callable

from robot_agent.models import BatteryState, DiagnosticsData, OdometryData


class ROSAdapter(ABC):
    @abstractmethod
    def publish_cmd_vel(self, linear: float, angular: float) -> None:
        """Send a velocity command to the robot."""

    @abstractmethod
    def subscribe_camera(self, callback: Callable[[bytes], None]) -> None:
        """Register a callback for raw camera frames."""

    @abstractmethod
    def subscribe_odometry(self, callback: Callable[[OdometryData], None]) -> None:
        """Register a callback fired whenever odometry updates."""

    @abstractmethod
    def subscribe_diagnostics(self, callback: Callable[[DiagnosticsData], None]) -> None:
        """Register a callback fired whenever diagnostics update."""

    @abstractmethod
    def subscribe_battery(self, callback: Callable[[BatteryState], None]) -> None:
        """Register a callback fired whenever battery state updates."""


class MQTTClientInterface(ABC):
    @abstractmethod
    async def connect(self) -> None:
        """Connect (retrying with backoff as needed) and start the network loop."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect cleanly."""

    @abstractmethod
    def set_will(self, topic: str, payload: str, qos: int, retain: bool) -> None:
        """Register a Last-Will-and-Testament message. Must be called before connect()."""

    @abstractmethod
    def publish(self, topic: str, payload: str, qos: int = 0, retain: bool = False) -> None: ...

    @abstractmethod
    def subscribe(self, topic: str, qos: int, callback: Callable[[dict], None]) -> None: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...
