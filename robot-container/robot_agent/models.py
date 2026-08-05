"""Domain models the agent works with - deliberately independent of ROS2
message types. The real ROSAdapter (Milestone 5) converts actual ROS2
messages (nav_msgs/Odometry, sensor_msgs/BatteryState, diagnostic_msgs/
DiagnosticArray) into these same shapes before invoking a subscription
callback - this is what keeps ROS2 specifics out of robot_agent/ entirely.
See docs/04-robot-agent.md.
"""
from dataclasses import dataclass
from typing import Optional


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


@dataclass(frozen=True)
class CameraFrame:
    """One raw camera frame. `encoding` is the ROS2 sensor_msgs/Image encoding
    string (e.g. "rgb8", "bgr8") - VideoStreamer needs it, along with
    width/height, to build correct GStreamer caps. Added in Milestone 6;
    subscribe_camera's callback type evolved from Milestone 4's placeholder
    `Callable[[bytes], None]` once there was an actual consumer that needed
    more than raw bytes - see docs/06-video-streaming.md."""

    data: bytes
    width: int
    height: int
    encoding: str


@dataclass(frozen=True)
class LaserScanData:
    """One 2D LIDAR scan - the same fields as ROS2's sensor_msgs/LaserScan
    that actually matter for rendering a top-down view (see
    docs/api-reference.md's `lidar` topic entry): `ranges[i]` is the
    distance reading at angle `angle_min + i * angle_increment`, or `None`
    where the sensor detected nothing within range - ROS2 represents that
    as `inf` (see real_ros_adapter.py's _handle_laser_scan(), which
    converts it), which is NOT valid JSON and would break `JSON.parse()`
    on every browser that ever received one unconverted; `None`/`null` is
    both valid JSON and the semantically correct way to say "no detection
    here" rather than a number a chart might try to plot. `intensities` is
    deliberately not carried here - this pipeline only ever renders
    distance, and dropping it roughly halves the payload size over MQTT
    for no loss of function.
    """

    angle_min: float
    angle_max: float
    angle_increment: float
    range_min: float
    range_max: float
    ranges: list[Optional[float]]
