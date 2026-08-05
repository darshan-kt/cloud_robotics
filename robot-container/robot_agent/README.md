# robot-container/robot_agent/

**Purpose:** the Robot Cloud Agent — the single component allowed to speak both MQTT (outward, to the cloud) and ROS2 (inward, to the robot). See [`docs/00-overview.md`](../../docs/00-overview.md) for why this boundary exists.

**Deliberately ROS2-agnostic.** This package must never `import rclpy`. It depends on a `ROSAdapter` *interface* only — the real ROS2 implementation lives in [`ros_ws/`](../ros_ws/) and is injected at startup. This is what lets the agent's core logic be unit-tested without ROS2 or a robot present.

**Contains:**
- `interfaces.py` — `ROSAdapter` and `MQTTClientInterface` abstract interfaces
- `mock_ros_adapter.py` — the `ROSAdapter` that actually runs today (no ROS2 dependency); swapped for `ros_ws/`'s real one in Milestone 5
- `mqtt_client.py` — `PahoMQTTClient` (connect/reconnect with backoff, publish, subscribe, resubscribe-on-reconnect)
- `dispatcher.py` — `CommandDispatcher` (MQTT command → `ROSAdapter.publish_cmd_vel()`)
- `health_server.py` — local `GET /health` / `GET /metrics` for the container orchestrator
- `watchdog.py` — notices prolonged MQTT disconnection, triggers a restart
- `config.py`, `logging_config.py` — YAML+env configuration, structured JSON logging
- `agent.py` — `RobotCloudAgent`, exposing `connect()`, `disconnect()`, `publish_telemetry()`, `receive_command()`, `publish_health()`, `publish_lidar_scan()` (post-Milestone-11), `stream_video()`, `shutdown()`, `restart()`, `heartbeat()`
- `main.py` — composition root; the one place concrete implementations are chosen

WebRTC video streaming (`stream_video()`) is present on the interface but not implemented yet — it arrives with the GStreamer/WebRTC pipeline in Milestone 6.

**Filled in:** Milestone 4 — see [`docs/04-robot-agent.md`](../../docs/04-robot-agent.md). Wired to the real `ROSAdapter` in Milestone 5.
