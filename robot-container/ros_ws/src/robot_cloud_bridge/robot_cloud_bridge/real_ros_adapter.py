"""The real ROSAdapter (Milestone 5) - bridges robot_agent's ROSAdapter
interface to actual ROS2 topics against a simulated Turtlebot3 in Gazebo.

This is the only place in the whole repository that imports rclpy. It
implements the exact same interface, and the exact same
"store-the-callback, dispatch-from-a-background-thread" pattern, as
mock_ros_adapter.py's MockROSAdapter - which is why swapping one for the
other in main.py requires zero changes anywhere else. See
docs/04-robot-agent.md and docs/05-ros2-integration.md.

As of Milestone 6, subscribe_camera() is also real: /camera/image_raw feeds
VideoStreamer's GStreamer pipeline via agent.py. That topic's publisher is
webcam_driver.py (a real, locally-attached webcam), not Gazebo's simulated
camera sensor - this adapter doesn't know or care which one is publishing,
same as it's always been agnostic about what feeds /odom. See
docs/06-video-streaming.md. subscribe_battery/subscribe_diagnostics remain
honest logged stubs - Turtlebot3's Gazebo stack has no real topics to
bridge for either, see docs/05-ros2-integration.md.

subscribe_lidar() is also real (added post-Milestone-11, alongside the
frontend's LiDAR panel): /scan is Gazebo's simulated Turtlebot3 LDS-01
LIDAR sensor, published natively by the turtlebot3_waffle_pi model itself -
nothing extra to launch, unlike the camera's webcam_driver.py. See
docs/api-reference.md's `lidar` MQTT topic entry.
"""
import logging
import math
import threading
from typing import Callable, Optional

import rclpy
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from sensor_msgs.msg import Image, LaserScan

from robot_agent.interfaces import ROSAdapter
from robot_agent.models import BatteryState, CameraFrame, DiagnosticsData, LaserScanData, OdometryData


def _yaw_from_quaternion(x: float, y: float, z: float, w: float) -> float:
    """Standard quaternion -> yaw (rotation about Z) conversion - no extra
    dependency (e.g. tf_transformations) needed for one formula."""
    siny_cosp = 2 * (w * z + x * y)
    cosy_cosp = 1 - 2 * (y * y + z * z)
    return math.atan2(siny_cosp, cosy_cosp)


class RealROSAdapter(ROSAdapter):
    def __init__(self, robot_id: str, logger: Optional[logging.Logger] = None):
        self._robot_id = robot_id
        self._logger = logger or logging.getLogger("robot_agent.real_ros_adapter")

        self._odometry_callback: Optional[Callable[[OdometryData], None]] = None
        self._diagnostics_callback: Optional[Callable[[DiagnosticsData], None]] = None
        self._battery_callback: Optional[Callable[[BatteryState], None]] = None
        self._camera_callback: Optional[Callable[[CameraFrame], None]] = None
        self._lidar_callback: Optional[Callable[[LaserScanData], None]] = None

        self._node: Optional[Node] = None
        self._executor: Optional[SingleThreadedExecutor] = None
        self._spin_thread: Optional[threading.Thread] = None
        self._cmd_vel_publisher = None

    def start(self) -> None:
        rclpy.init(args=None)
        self._node = Node(f"{self._robot_id}_cloud_bridge")

        self._cmd_vel_publisher = self._node.create_publisher(Twist, "/cmd_vel", 10)
        self._node.create_subscription(Odometry, "/odom", self._handle_odometry, 10)
        # depth=1: always process the latest camera frame, never build up a
        # backlog of stale ones if VideoStreamer falls behind for a moment.
        self._node.create_subscription(Image, "/camera/image_raw", self._handle_camera_image, 1)
        # depth=1, same reasoning as camera above - agent.py's own periodic
        # publish loop (not this subscription's rate) decides how often a
        # scan actually goes out over MQTT, so only the latest one matters.
        self._node.create_subscription(LaserScan, "/scan", self._handle_laser_scan, 1)

        self._executor = SingleThreadedExecutor()
        self._executor.add_node(self._node)
        self._spin_thread = threading.Thread(target=self._executor.spin, daemon=True, name="ros2-spin")
        self._spin_thread.start()

        self._logger.info(
            "RealROSAdapter started - publishing /cmd_vel, subscribed to /odom, "
            "/camera/image_raw, and /scan"
        )

    def stop(self) -> None:
        if self._executor:
            self._executor.shutdown()
        if self._spin_thread:
            self._spin_thread.join(timeout=2)
        if self._node:
            self._node.destroy_node()
        rclpy.shutdown()

    # --- ROSAdapter ---
    def publish_cmd_vel(self, linear: float, angular: float) -> None:
        msg = Twist()
        msg.linear.x = linear
        msg.angular.z = angular
        self._cmd_vel_publisher.publish(msg)

    def subscribe_camera(self, callback: Callable[[CameraFrame], None]) -> None:
        self._camera_callback = callback

    def subscribe_odometry(self, callback: Callable[[OdometryData], None]) -> None:
        self._odometry_callback = callback

    def subscribe_diagnostics(self, callback: Callable[[DiagnosticsData], None]) -> None:
        self._logger.info(
            "subscribe_diagnostics() has no real ROS2 topic to bridge in this "
            "simulated setup - diagnostics will report null until a real source exists"
        )

    def subscribe_battery(self, callback: Callable[[BatteryState], None]) -> None:
        self._logger.info(
            "subscribe_battery() has no real topic to bridge - Turtlebot3's Gazebo "
            "stack doesn't model battery state - battery_percentage will report null"
        )

    def subscribe_lidar(self, callback: Callable[[LaserScanData], None]) -> None:
        self._lidar_callback = callback

    # --- rclpy callbacks (run on the executor's spin thread) ---
    def _handle_camera_image(self, msg: Image) -> None:
        if not self._camera_callback:
            return
        self._camera_callback(
            CameraFrame(
                data=bytes(msg.data),
                width=msg.width,
                height=msg.height,
                encoding=msg.encoding,
            )
        )

    def _handle_laser_scan(self, msg: LaserScan) -> None:
        if not self._lidar_callback:
            return
        # ROS2 represents "nothing detected within range" as `inf` (and,
        # rarely, an invalid reading as `nan`) - neither is valid JSON, and
        # `json.dumps` would happily emit the literal tokens `Infinity`/
        # `NaN` anyway (a Python-specific extension), which crashes
        # `JSON.parse()` in every browser the moment such a scan reaches
        # the frontend. math.isfinite() catches both; None/JSON null is
        # also the semantically correct "no detection here", not just a
        # workaround. round(): a real LDS-01 has nowhere near float64's
        # precision to begin with, and 360 unrounded floats is a
        # meaningfully bigger MQTT payload for zero real gain - see
        # docs/api-reference.md.
        self._lidar_callback(
            LaserScanData(
                angle_min=msg.angle_min,
                angle_max=msg.angle_max,
                angle_increment=msg.angle_increment,
                range_min=msg.range_min,
                range_max=msg.range_max,
                ranges=[round(r, 3) if math.isfinite(r) else None for r in msg.ranges],
            )
        )

    def _handle_odometry(self, msg: Odometry) -> None:
        if not self._odometry_callback:
            return
        orientation = msg.pose.pose.orientation
        self._odometry_callback(
            OdometryData(
                linear_velocity=msg.twist.twist.linear.x,
                angular_velocity=msg.twist.twist.angular.z,
                position_x=msg.pose.pose.position.x,
                position_y=msg.pose.pose.position.y,
                heading=_yaw_from_quaternion(
                    orientation.x, orientation.y, orientation.z, orientation.w
                ),
            )
        )
