# robot-container/robot_agent/

**Purpose:** the Robot Cloud Agent — the single component allowed to speak both MQTT (outward, to the cloud) and ROS2 (inward, to the robot). See [`docs/00-overview.md`](../../docs/00-overview.md) for why this boundary exists.

**Deliberately ROS2-agnostic.** This package must never `import rclpy`. It depends on a `ROSAdapter` *interface* only — the real ROS2 implementation lives in [`ros_ws/`](../ros_ws/) and is injected at startup. This is what lets the agent's core logic be unit-tested without ROS2 or a robot present.

**Will contain:**
- MQTT client wrapper (connect/reconnect, publish, subscribe)
- WebRTC client (video streaming to the browser)
- Command dispatcher (MQTT command → `ROSAdapter.publishCmdVel()`)
- Configuration loader (YAML + env vars)
- Structured logging
- Heartbeat, health monitor, watchdog thread
- The public agent interface: `connect()`, `disconnect()`, `publishTelemetry()`, `receiveCommand()`, `publishHealth()`, `streamVideo()`, `shutdown()`, `restart()`, `heartbeat()`
- The `ROSAdapter` abstract interface (implementation lives elsewhere)

**Filled in:** Milestone 4 (core agent, built and tested against a mock `ROSAdapter`), wired to the real adapter in Milestone 5.
