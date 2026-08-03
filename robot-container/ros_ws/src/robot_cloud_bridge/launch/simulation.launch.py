"""Headless simulation launch: Gazebo server (no GUI) + a Turtlebot3
waffle_pi spawned into the turtlebot3_world. See docs/05-ros2-integration.md
for why this platform runs Gazebo headless by default: the operator sees
the robot through the browser's WebRTC feed (Milestone 6), not a window on
the server - and there is no display in AWS either.

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

    ld = LaunchDescription()
    ld.add_action(gzserver_cmd)
    ld.add_action(robot_state_publisher_cmd)
    ld.add_action(spawn_turtlebot3_cmd)
    return ld
