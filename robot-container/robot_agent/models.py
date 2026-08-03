"""Domain models the agent works with - deliberately independent of ROS2
message types. The real ROSAdapter (Milestone 5) converts actual ROS2
messages (nav_msgs/Odometry, sensor_msgs/BatteryState, diagnostic_msgs/
DiagnosticArray) into these same shapes before invoking a subscription
callback - this is what keeps ROS2 specifics out of robot_agent/ entirely.
See docs/04-robot-agent.md.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class OdometryData:
    linear_velocity: float
    angular_velocity: float
    position_x: float
    position_y: float
    heading: float


@dataclass(frozen=True)
class BatteryState:
    percentage: float
    voltage: float
    is_charging: bool


@dataclass(frozen=True)
class DiagnosticsData:
    cpu_percent: float
    memory_percent: float
    temperature_c: float
