# robot-container/tests/

**Purpose:** tests for the robot-container codebase, split by what they depend on.

**Will contain:**
- Unit tests for `robot_agent/` — run against a mock `ROSAdapter`, no ROS2 or hardware required, fast enough for every commit.
- Integration tests that exercise the real ROS2 workspace (`ros_ws/`) — require a ROS2 environment, run less frequently (e.g. in CI with the full container image).

**Filled in:** Milestone 4 (agent unit tests), Milestone 5 (ROS2 integration tests).
