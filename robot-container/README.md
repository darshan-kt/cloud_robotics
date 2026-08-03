# robot-container

Everything that runs **on or next to the robot**: ROS2, the simulated Turtlebot3, and the Robot Cloud Agent that bridges ROS2 to the cloud over MQTT and streams video over WebRTC.

This container never receives direct calls from the cloud backend or the browser — it only speaks MQTT outward and serves a WebRTC peer connection outward. See the root [`README.md`](../README.md) and [`docs/00-overview.md`](../docs/00-overview.md) for why.

## Layout

| Folder | Purpose |
|---|---|
| [`docker/`](docker/) | Container build (Dockerfile, entrypoint). |
| [`robot_agent/`](robot_agent/) | ROS2-agnostic Python agent: MQTT, WebRTC, dispatcher, health, DI-injected `ROSAdapter` interface. |
| [`ros_ws/`](ros_ws/) | ROS2 workspace — Turtlebot3 integration and the concrete `ROSAdapter`. Only place `rclpy` is imported. |
| [`launch/`](launch/) | ROS2 launch files (Gazebo + Turtlebot3 + agent node). |
| [`config/`](config/) | YAML configuration (robot ID, MQTT address, topics, bitrate). |
| [`scripts/`](scripts/) | Entrypoints and dev/ops helper scripts. |
| [`tests/`](tests/) | Unit tests (agent, no ROS2 needed) and integration tests (with ROS2). |
| [`docs/`](docs/) | Robot-side implementation notes. |

Status: scaffolding only (Milestone 1). Build details land starting Milestone 2.
