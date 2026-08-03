# robot-container/docker/

**Purpose:** container build assets for the robot image — Dockerfile, entrypoint script, and any build-time resources needed to produce a runnable robot container.

**Will contain:** a `Dockerfile` based on `ros:humble-ros-base` (Ubuntu 22.04 + ROS2 Humble), Python dependencies for the Robot Cloud Agent, and an entrypoint that starts the agent process.

**Filled in:** Milestone 2 (base image + agent runtime), extended in Milestone 5 to layer in Turtlebot3 and Gazebo dependencies.
