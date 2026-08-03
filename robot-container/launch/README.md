# robot-container/launch/

**Purpose:** ROS2 launch files that bring up the simulation and the agent's ROS2-side node together, so the whole robot stack starts with one command.

**Will contain:** a launch file starting Gazebo with the Turtlebot3 world, the Turtlebot3 driver/simulation nodes, and the `ROSAdapter` node, all reading parameters from [`config/`](../config/).

**Filled in:** Milestone 5.
