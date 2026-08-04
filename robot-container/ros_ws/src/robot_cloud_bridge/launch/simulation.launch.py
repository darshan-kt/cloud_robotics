"""Headless simulation launch: Gazebo server (no GUI) + a Turtlebot3
waffle_pi spawned into the turtlebot3_world, plus the real webcam driver
(Milestone 6, respun - see webcam_driver.py). Gazebo drives physics/
cmd_vel/odom; the camera feed comes from a real, locally-attached webcam
instead of Gazebo's own simulated camera sensor, which is no longer used at
all. See docs/05-ros2-integration.md for why this platform runs Gazebo
headless by default: the operator sees the robot through the browser's
WebRTC feed, not a window on the server - and there is no display in AWS
either.

Deliberately does NOT reuse turtlebot3_gazebo's own turtlebot3_world.launch.py
as-is, since that one also starts gzclient (the GUI) - rather than hope a
`gui:=false` argument threads through correctly, this launch file is
explicit: it includes gazebo_ros's gzserver.launch.py (server-only, so it
structurally cannot open a GUI) and never includes gzclient.launch.py at
all. It does reuse turtlebot3_gazebo's own robot_state_publisher.launch.py
and spawn_turtlebot3.launch.py, rather than re-implementing URDF/xacro
processing by hand.
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    turtlebot3_gazebo_dir = get_package_share_directory("turtlebot3_gazebo")
    gazebo_ros_dir = get_package_share_directory("gazebo_ros")

    use_sim_time = LaunchConfiguration("use_sim_time", default="true")
    x_pose = LaunchConfiguration("x_pose", default="-2.0")
    y_pose = LaunchConfiguration("y_pose", default="-0.5")

    world = os.path.join(turtlebot3_gazebo_dir, "worlds", "turtlebot3_world.world")

    gzserver_cmd = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(gazebo_ros_dir, "launch", "gzserver.launch.py")
        ),
        launch_arguments={"world": world, "verbose": "false"}.items(),
    )

    robot_state_publisher_cmd = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(turtlebot3_gazebo_dir, "launch", "robot_state_publisher.launch.py")
        ),
        launch_arguments={"use_sim_time": use_sim_time}.items(),
    )

    spawn_turtlebot3_cmd = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            os.path.join(turtlebot3_gazebo_dir, "launch", "spawn_turtlebot3.launch.py")
        ),
        launch_arguments={"x_pose": x_pose, "y_pose": y_pose}.items(),
    )

    # Real webcam -> /camera/image_raw (Milestone 6, respun). Configured via
    # env vars (CAMERA_DEVICE/CAMERA_WIDTH/CAMERA_HEIGHT/CAMERA_FPS/
    # CAMERA_TEST_PATTERN_FALLBACK), the same convention robot_agent's own
    # config.py uses, rather than ROS parameters - see webcam_driver.py and
    # docs/06-video-streaming.md.
    webcam_driver_cmd = Node(
        package="robot_cloud_bridge",
        executable="webcam_driver",
        name="webcam_driver",
        output="screen",
    )

    ld = LaunchDescription()
    ld.add_action(gzserver_cmd)
    ld.add_action(robot_state_publisher_cmd)
    ld.add_action(spawn_turtlebot3_cmd)
    ld.add_action(webcam_driver_cmd)
    return ld
