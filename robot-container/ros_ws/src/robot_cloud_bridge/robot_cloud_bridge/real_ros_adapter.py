"""The real ROSAdapter (Milestone 5) - bridges robot_agent's ROSAdapter
interface to actual ROS2 topics against a simulated Turtlebot3 in Gazebo.

This is the only place in the whole repository that imports rclpy. It
implements the exact same interface, and the exact same
"store-the-callback, dispatch-from-a-background-thread" pattern, as
mock_ros_adapter.py's MockROSAdapter - which is why swapping one for the
other in main.py requires zero changes anywhere else. See
docs/04-robot-agent.md and docs/05-ros2-integration.md.

Scope for this milestone (see docs/05-ros2-integration.md for why): only
publish_cmd_vel (-> /cmd_vel) and subscribe_odometry (<- /odom) are real
ROS2 data paths. subscribe_camera/subscribe_battery/subscribe_diagnostics
are honest logged stubs, same pattern as MockROSAdapter's own camera stub -
camera activates in Milestone 6, and Turtlebot3's Gazebo stack has no real
battery/diagnostics topics to bridge in the first place.
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

from robot_agent.interfaces import ROSAdapter
from robot_agent.models import BatteryState, DiagnosticsData, OdometryData


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

        self._node: Optional[Node] = None
        self._executor: Optional[SingleThreadedExecutor] = None
        self._spin_thread: Optional[threading.Thread] = None
        self._cmd_vel_publisher = None

    def start(self) -> None:
        rclpy.init(args=None)
        self._node = Node(f"{self._robot_id}_cloud_bridge")

        self._cmd_vel_publisher = self._node.create_publisher(Twist, "/cmd_vel", 10)
        self._node.create_subscription(Odometry, "/odom", self._handle_odometry, 10)

        self._executor = SingleThreadedExecutor()
        self._executor.add_node(self._node)
        self._spin_thread = threading.Thread(target=self._executor.spin, daemon=True, name="ros2-spin")
        self._spin_thread.start()

        self._logger.info(f"RealROSAdapter started - publishing /cmd_vel, subscribed to /odom")

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

    def subscribe_camera(self, callback: Callable[[bytes], None]) -> None:
        self._logger.info(
            "subscribe_camera() not wired up yet - the camera topic exists on the "
            "waffle_pi model, but nothing consumes it until the GStreamer/WebRTC "
            "pipeline arrives in Milestone 6"
        )

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

    # --- rclpy callback (runs on the executor's spin thread) ---
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
