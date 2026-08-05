"""Interfaces the agent depends on. Concrete implementations are injected
at composition time (see main.py) - the agent itself never constructs them.

ROSAdapter: mock_ros_adapter.py's MockROSAdapter (used for fast, ROS2-free
unit tests - see robot-container/tests/) and ros_ws/'s RealROSAdapter
(what main.py actually injects, since Milestone 5). Both implement this
exact same interface, which is why swapping one for the other never
touches agent.py. This is exactly why robot_agent/ must never import
rclpy: doing so would tie this interface's only consumer to one
implementation, defeating the point of having the interface at all.

MQTTClientInterface: today, mqtt_client.py's PahoMQTTClient. Exists mainly
so tests can inject an in-memory fake instead of a real broker connection -
see robot-container/tests/fake_mqtt_client.py.
"""
from abc import ABC, abstractmethod
from typing import Callable

from robot_agent.models import BatteryState, CameraFrame, DiagnosticsData, LaserScanData, OdometryData


class ROSAdapter(ABC):
    @abstractmethod
    def publish_cmd_vel(self, linear: float, angular: float) -> None:
        """Send a velocity command to the robot."""

    @abstractmethod
    def subscribe_camera(self, callback: Callable[[CameraFrame], None]) -> None:
        """Register a callback fired for every raw camera frame."""

    @abstractmethod
    def subscribe_odometry(self, callback: Callable[[OdometryData], None]) -> None:
        """Register a callback fired whenever odometry updates."""

    @abstractmethod
    def subscribe_diagnostics(self, callback: Callable[[DiagnosticsData], None]) -> None:
        """Register a callback fired whenever diagnostics update."""

    @abstractmethod
    def subscribe_battery(self, callback: Callable[[BatteryState], None]) -> None:
        """Register a callback fired whenever battery state updates."""

    @abstractmethod
    def subscribe_lidar(self, callback: Callable[[LaserScanData], None]) -> None:
        """Register a callback fired whenever a new 2D LIDAR scan arrives."""


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
