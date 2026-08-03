# robot-container/launch/

**Purpose:** ROS2 launch files that bring up the simulation and the agent's ROS2-side node together, so the whole robot stack starts with one command.

**Correction from the original Milestone 1 plan:** this folder was expected to hold the simulation launch file, but `ros2 launch <package> <file>` requires launch files to live *inside the ROS2 package that owns them* (installed into that package's share directory by `colcon build`) - a flat top-level folder outside any package isn't resolvable that way. The real launch file lives at [`ros_ws/src/robot_cloud_bridge/launch/simulation.launch.py`](../ros_ws/src/robot_cloud_bridge/launch/simulation.launch.py) instead - see [`docs/05-ros2-integration.md`](../../docs/05-ros2-integration.md). This folder is kept as a placeholder in case a future milestone needs a non-package-specific launch entrypoint, but currently holds nothing.
