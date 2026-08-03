#!/bin/bash
# Container entrypoint. As of Milestone 5, this container hosts the robot's
# entire simulated onboard stack - headless Gazebo + a spawned Turtlebot3,
# plus the Robot Cloud Agent - the same way a real robot's companion
# computer runs many ROS2 processes as one integrated system, not a single
# microservice. See docs/05-ros2-integration.md.
# No `-u`: ROS2's setup.bash scripts reference their own unset variables
# internally (e.g. AMENT_TRACE_SETUP_FILES) - a well-known interaction
# issue between `set -u` and ROS2 tooling, not a bug in our own code.
set -eo pipefail

# shellcheck source=/opt/ros/humble/setup.bash
source /opt/ros/humble/setup.bash
# shellcheck source=/robot/ros_ws/install/setup.bash
source /robot/ros_ws/install/setup.bash
# Gazebo's OWN environment script (not a ROS2 file) - sets GAZEBO_PLUGIN_PATH
# and GAZEBO_MODEL_PATH. Without it, gzserver can't find libgazebo_ros_factory.so
# (so /spawn_entity never appears - spawn_entity.py times out after 30s) or
# the world file's referenced models. Easy to miss since ROS2's own setup.bash
# gives no hint this second script exists.
# shellcheck source=/usr/share/gazebo/setup.sh
source /usr/share/gazebo/setup.sh

echo "Starting headless Gazebo + Turtlebot3 (${TURTLEBOT3_MODEL}) simulation..."
ros2 launch robot_cloud_bridge simulation.launch.py &

# Simulation startup isn't strictly required before the agent starts - ROS2
# discovery is eventually consistent, publishers/subscribers just connect
# whenever both sides exist - but a short pause avoids a noisy burst of
# "topic not found yet" activity in the first few seconds of logs.
sleep 5

exec python3 -m robot_agent.main
