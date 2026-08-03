# robot-container/ros_ws/

**Purpose:** the actual ROS2 workspace (`src/` packages, built with `colcon`). This is the **only** place in the repository where `rclpy` and ROS2 message types are imported.

**Will contain:**
- Turtlebot3 package integration (simulation via Gazebo)
- The concrete `ROSAdapter` implementation — `publishCmdVel()`, `subscribeCamera()`, `subscribeOdometry()`, `subscribeDiagnostics()`, `subscribeBattery()` — satisfying the interface defined in [`robot_agent/`](../robot_agent/)
- The camera → GStreamer bridge node

**Filled in:** Milestone 5 (Turtlebot3 + Gazebo + `ROSAdapter`), extended in Milestone 6 (camera pipeline).
