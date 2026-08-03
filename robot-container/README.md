# robot-container

Everything that runs **on or next to the robot**: ROS2, the simulated Turtlebot3, and the Robot Cloud Agent that bridges ROS2 to the cloud over MQTT and streams video over WebRTC.

This container never receives direct calls from the cloud backend or the browser — it only speaks MQTT outward and serves a WebRTC peer connection outward. See the root [`README.md`](../README.md) and [`docs/00-overview.md`](../docs/00-overview.md) for why.

## Layout

| Folder | Purpose |
|---|---|
| [`docker/`](docker/) | Container build (Dockerfile, entrypoint). |
| [`robot_agent/`](robot_agent/) | ROS2-agnostic Python agent: MQTT, WebRTC, dispatcher, health, DI-injected `ROSAdapter` interface. |
| [`ros_ws/`](ros_ws/) | ROS2 workspace — Turtlebot3 (cloned) + our `robot_cloud_bridge` package (`RealROSAdapter` + the simulation launch file). Only place `rclpy` is imported. |
| [`launch/`](launch/) | Reserved placeholder - ROS2 launch files must live inside their owning package, so the real one is at `ros_ws/src/robot_cloud_bridge/launch/`, not here. See that folder's README. |
| [`config/`](config/) | YAML configuration (robot ID, MQTT address, topics, bitrate). |
| [`scripts/`](scripts/) | Entrypoints and dev/ops helper scripts. |
| [`tests/`](tests/) | Unit tests (agent, no ROS2 needed) and integration tests (with ROS2). |
| [`docs/`](docs/) | Robot-side implementation notes. |

Status: Milestones 1-5 complete — real Robot Cloud Agent + headless Gazebo/Turtlebot3 simulation running. See the root [`README.md`](../README.md) and [`docs/`](../docs/) for details.
