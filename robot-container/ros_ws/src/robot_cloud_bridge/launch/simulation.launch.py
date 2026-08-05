"""Simulation launch: Gazebo server + a Turtlebot3 waffle_pi spawned into
the turtlebot3_world, plus the real webcam driver (Milestone 6, respun -
see webcam_driver.py). Gazebo drives physics/cmd_vel/odom; the camera feed
comes from a real, locally-attached webcam instead of Gazebo's own
simulated camera sensor, which is no longer used at all.

Headless (gzserver only) is still what actually ships - see
docs/05-ros2-integration.md for why: the operator sees the robot through
the browser's WebRTC feed, not a window on the server, and there is no
display to attach to in AWS either. gzclient (the GUI) is purely a local
development convenience, and is entirely conditional on whether a real X11
`DISPLAY` was actually passed into the container (see docker-compose.yml's
`robot` service and README.md's "Watching the simulation visually") -
checked once, here, at launch-description-generation time, in plain Python
rather than a launch-file substitution/condition, since this doesn't need
to be reconfigurable at runtime. On a host with no DISPLAY (a real
headless server, CI, or a future AWS-hosted edge deployment), this
condition is simply false and gzserver runs exactly as it always did -
this is additive, not a replacement for the "structurally cannot open a
GUI unless asked to" design gzserver.launch.py (server-only, never
gzclient.launch.py, unless explicitly included below) already gives us.
It does reuse turtlebot3_gazebo's own robot_state_publisher.launch.py and
spawn_turtlebot3.launch.py, rather than re-implementing URDF/xacro
processing by hand.
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import ExecuteProcess, IncludeLaunchDescription, LogInfo
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

    # See the module docstring - purely additive, gated on a real DISPLAY
    # actually being present, never required for the simulation itself to
    # come up correctly.
    #
    # Deliberately a plain `gzclient` ExecuteProcess, NOT
    # gazebo_ros's own gzclient.launch.py - that file unconditionally
    # injects `--gui-client-plugin=libgazebo_ros_eol_gui.so` (a Gazebo-
    # Classic-deprecation-notice HUD overlay) into the command with no way
    # to opt out. Confirmed by direct comparison under this container's
    # real resource constraints: with that plugin, gzclient's CPU climbed
    # continuously (139% -> 166%+ over two minutes) and never actually
    # mapped a window; a plain `gzclient` with no extra plugin loads
    # normally (real splash screen, settles into steady-state ~20-100%
    # CPU, window renders). Not worth carrying a broken-under-load plugin
    # just to keep reusing someone else's launch file unmodified.
    has_display = bool(os.environ.get("DISPLAY"))
    gzclient_cmd = ExecuteProcess(cmd=["gzclient"], output="screen")
    gui_status_log = LogInfo(
        msg=(
            f"DISPLAY={os.environ.get('DISPLAY')!r} - starting gzclient (GUI) too"
            if has_display
            else "No DISPLAY set - running headless (gzserver only), as always. "
            "See docker-compose.yml's robot service / README.md to opt in."
        )
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
    ld.add_action(gui_status_log)
    ld.add_action(gzserver_cmd)
    if has_display:
        ld.add_action(gzclient_cmd)
    ld.add_action(robot_state_publisher_cmd)
    ld.add_action(spawn_turtlebot3_cmd)
    ld.add_action(webcam_driver_cmd)
    return ld
