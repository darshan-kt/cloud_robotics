# robot-container/ros_ws/

**Purpose:** the actual ROS2 workspace (`src/` packages, built with `colcon`). This is the **only** place in the repository where `rclpy` and ROS2 message types are imported.

**Contains:**
- `src/turtlebot3_simulations/` — cloned from ROBOTIS-GIT (branch `humble`) at image build time; provides `turtlebot3_gazebo`'s worlds, models, and launch files (`robot_state_publisher.launch.py`, `spawn_turtlebot3.launch.py`) that our own launch file reuses.
- `src/robot_cloud_bridge/` — our own `ament_python` package, the *only* place in the repo that imports `rclpy`:
  - `real_ros_adapter.py` — `RealROSAdapter`, the concrete `ROSAdapter` implementation injected by `robot_agent/main.py` since Milestone 5. `publish_cmd_vel()` and `subscribe_odometry()` bridge real `/cmd_vel` and `/odom`; `subscribe_camera()`/`subscribe_battery()`/`subscribe_diagnostics()` are honest stubs (camera activates in Milestone 6; Turtlebot3's Gazebo stack has no real battery/diagnostics topics to bridge).
  - `launch/simulation.launch.py` — headless (`gzserver`-only, no GUI) simulation launch, spawning a `waffle_pi` into `turtlebot3_world`.

Built with `colcon build` at **image build time** (see `robot-container/docker/Dockerfile`), not at container startup.

**Filled in:** Milestone 5 — see [`docs/05-ros2-integration.md`](../../docs/05-ros2-integration.md). Camera pipeline extends this in Milestone 6.
