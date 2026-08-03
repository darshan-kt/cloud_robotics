# 04 — The Robot Cloud Agent

## What this step is

`scripts/heartbeat_placeholder.py` — a single script that only ever proved MQTT connectivity — is gone. In its place is `robot_agent/`, a small package of eleven single-responsibility modules implementing the component the master spec treats as the architectural centerpiece of the robot side: the thing that translates between the cloud's world (MQTT, JSON, discrete commands) and the robot's world (ROS2 topics, continuous velocities, sensor streams) — without knowing ROS2 exists yet.

It exposes exactly the public surface the spec names — `connect`, `disconnect`, `publishTelemetry`, `receiveCommand`, `publishHealth`, `streamVideo`, `shutdown`, `restart`, `heartbeat` — as Python `snake_case` (`connect()`, `publish_telemetry()`, etc. — idiomatic Python, same intent as the spec's camelCase).

## Why it's needed

### The interface/DI payoff, made concrete instead of theoretical

`robot_agent/interfaces.py` defines `ROSAdapter` as an abstract base class with five methods (`publish_cmd_vel`, `subscribe_camera`, `subscribe_odometry`, `subscribe_diagnostics`, `subscribe_battery`) and zero ROS2 imports. `robot_agent/mock_ros_adapter.py` implements it with a background thread that synthesizes plausible odometry/battery/diagnostics data — no ROS2, no hardware, no Gazebo.

The important part: **`main.py` injects `MockROSAdapter` right now, and the whole agent runs against it for real** in `docker compose up` — this isn't a test-only double, it's what's actually running in the container today. When Milestone 5 builds `ros_ws/`'s real, `rclpy`-backed `ROSAdapter`, swapping it in is a four-line change in `main.py`'s composition root:

```python
# today:
ros_adapter = MockROSAdapter(robot_id=config.robot_id)
# Milestone 5:
ros_adapter = RealROSAdapter(robot_id=config.robot_id, node=ros_node)
```

Nothing in `agent.py`, `dispatcher.py`, or anywhere else changes, because none of them know which implementation they're talking to — they only know the `ROSAdapter` interface. This is what "use dependency injection" and "use interfaces wherever appropriate" *buy* you: a component that's fully built, running, and testable before its riskiest dependency (real ROS2 + Gazebo + Turtlebot3) even exists.

`MQTTClientInterface` (also in `interfaces.py`) plays the same role for the MQTT layer: `mqtt_client.py`'s `PahoMQTTClient` is the real implementation; `tests/fake_mqtt_client.py` is an in-memory double used only in unit tests, which is why the whole agent — `connect()`, command dispatch, every publish — can be unit-tested (see `tests/test_agent.py`) without a broker, a network, or Docker.

### Why the domain models exist (`models.py`)

`OdometryData`, `BatteryState`, `DiagnosticsData` are plain dataclasses that belong to the agent, not to ROS2. This is the Adapter pattern applied deliberately: Milestone 5's real `ROSAdapter` will receive actual ROS2 messages (`nav_msgs/Odometry`, `sensor_msgs/BatteryState`, `diagnostic_msgs/DiagnosticArray`) and convert them into these same shapes before invoking a callback. The conversion logic — and only the conversion logic — lives in `ros_ws/`. Everything downstream of it (telemetry publishing, health publishing) only ever sees the agent's own vocabulary. If Turtlebot3 were swapped for a different robot with entirely different ROS2 message types tomorrow, only that one conversion point would change.

### Why mixed sync/async, not "everything async"

The spec asks for asynchronous programming, and it's used where it earns its keep: `connect()`, `disconnect()`, `shutdown()`, `restart()`, and `agent.run()` are all `async def`, because `run()` coordinates four genuinely concurrent, long-lived loops (heartbeat, telemetry, health, watchdog) via `asyncio.gather()`, and `connect()` awaits a real exponential-backoff retry loop instead of blocking the whole process with `time.sleep()` the way the old placeholder did.

`heartbeat()`, `publish_telemetry()`, `publish_health()`, and `receive_command()` stay plain synchronous methods. They're fast, local, non-blocking calls — build a dict, call `mqtt.publish()` — and `receive_command()` in particular is invoked directly from paho-mqtt's own background callback thread (see `mqtt_client.py`'s `_handle_message`). Routing that through the event loop would mean bridging every single incoming command across threads for no real benefit; a fast synchronous call is simpler and just as correct. Async is a tool for coordinating concurrent, I/O-bound work — not a rule to apply uniformly regardless of whether a given piece of code needs it.

### Why re-subscribing on every reconnect matters (and was almost a bug)

MQTT brokers don't remember a client's subscriptions across a fresh connection — a robot that reconnects after a network blip has to re-subscribe to `cmd`, or it will silently stop receiving commands forever after that point, with no error anywhere. `PahoMQTTClient._handle_connect` re-subscribes every tracked topic on **every** successful CONNACK, not just the first one — this is exactly the kind of correctness detail that's easy to get right the first time and easy to silently lose the second time a component gets refactored, which is why it's called out explicitly here and covered by re-connection being part of what the watchdog exercises.

### Why a watchdog on top of paho's own reconnect logic

paho already retries the underlying connection forever via `reconnect_delay_set()`. The watchdog (`watchdog.py`) is a separate, higher-level check: "how long has `is_connected` been false?" If it crosses a threshold (`watchdog_unhealthy_after_seconds`, default 15s), it logs a loud warning and calls `agent.restart()` — a full disconnect + reconnect cycle, not just waiting on paho. This matters because a connection can be technically "retrying" in a way that never actually recovers (e.g., a broker that's up but rejecting this client for some reason); the watchdog is what notices that and does something more decisive than just waiting. It's built as a standalone class taking `is_connected`/`on_unhealthy` as constructor-injected callables, so it's testable with no relationship to the real agent at all.

### Why two separate "health" concepts exist

- **`robots/{id}/health`** (MQTT topic, `publish_health()`) — reports to the **fleet backend**: CPU, memory, temperature, whether MQTT is connected. This is fleet-monitoring data, consumed by whoever operates the robot remotely.
- **`GET /health` / `GET /metrics`** (local HTTP, `health_server.py`) — reports to the **container orchestrator**: Docker's `HEALTHCHECK` today, an ECS task health check or Kubernetes liveness probe later. This is infrastructure data, consumed by whatever decides "should this container be restarted."

They look similar but answer different questions for different audiences, which is why they're two separate code paths rather than one. `health_server.py` is deliberately stdlib-only (`http.server`) — robot-container's tech stack has no web framework, and two GET endpoints don't need one.

### The command → velocity mapping

`dispatcher.py` maps the five known commands to `(linear, angular)` velocity pairs: `forward`/`backward` set linear velocity; `left`/`right` are pure in-place rotation (angular velocity only); `stop` zeroes both. This is the simplest, most orthogonal reading of five discrete, independent commands, and it's isolated in one small function — changing to, say, a curved turn while moving is a one-function edit, not a design change. Unknown commands are logged and rejected, never raised — one malformed MQTT message must not be able to crash the agent (see `KNOWN_COMMANDS` and `dispatch()`'s return value, which every caller checks).

## What it does

| File | Responsibility |
|---|---|
| `models.py` | `OdometryData`, `BatteryState`, `DiagnosticsData` - the agent's own domain vocabulary |
| `interfaces.py` | `ROSAdapter` and `MQTTClientInterface` abstract base classes |
| `mock_ros_adapter.py` | The adapter that actually runs today; synthesizes telemetry on a timer |
| `mqtt_client.py` | `PahoMQTTClient` - async connect with backoff, resubscribe-on-reconnect, exception-wrapped message dispatch |
| `dispatcher.py` | `CommandDispatcher` - command name → velocities |
| `health_server.py` | Local `GET /health` / `GET /metrics` for the container orchestrator |
| `watchdog.py` | Notices prolonged disconnection, triggers `restart()` |
| `config.py` | `AgentConfig` - same explicit env-over-YAML precedence as the backend's config loader |
| `logging_config.py` | Structured JSON logs, same shape as every other service in this platform |
| `agent.py` | `RobotCloudAgent` - the composed service, owns the four concurrent loops |
| `main.py` | Composition root - the only place concrete implementations get chosen |

Also this milestone:
- `robot-container/docker/Dockerfile` now has a real `HEALTHCHECK` hitting `/health` (Python's stdlib `urllib`, no new package) - the `robot` service in `docker-compose.yml` finally reaches Docker's `healthy` state instead of just "running", which `docs/02-docker-foundations.md` flagged as deferred to exactly this milestone.
- `config/default.yaml` gained `intervals:`, `motion:`, and `health_server:` sections, all overridable via environment variables, none hardcoded anywhere in the code.
- `robot-container/tests/` - 17 true unit tests (`test_dispatcher.py`, `test_agent.py`, `test_mock_ros_adapter.py`), all running in well under a second with no Docker, no broker, and no ROS2, using `FakeMQTTClient` and `RecordingROSAdapter` test doubles.

## Verification

This was run, not just written:

- `pytest tests/` from `robot-container/` — 17/17 passed, no Docker needed
- `docker compose up -d --build` — `robot` reaches Docker's `healthy` state for the first time
- `curl http://localhost:8080/health` / `/metrics` — real JSON, real counters that increase over time
- Subscribed to `robots/+/telemetry` and `robots/+/health` directly on the broker and confirmed real messages arriving on schedule
- Published a real `{"command": "forward"}` to `robots/turtlebot3_01/cmd` as the `backend` MQTT user and watched the agent's logs dispatch it, then watched telemetry's `position.x` actually advance and `battery_percentage` actually drain on the next tick — the full backend→robot command path, working end-to-end, months before a real robot exists
- `docker kill -9`'d the robot again (as in Milestone 3) and confirmed the *new* agent's Last-Will-and-Testament still correctly flips `robots/{id}/status` to `offline`, then recovers to `online` on restart

## Running it yourself

```bash
cd robot-container && pip install -r requirements.txt -r tests/requirements.txt
pytest tests/ -v                      # unit tests, no Docker needed

cd ..
docker compose up -d --build
curl http://localhost:8080/health
docker compose logs -f robot          # watch heartbeat/telemetry/health/commands

# from another terminal, pretend to be the backend sending a command:
docker exec cloud-robotics-mosquitto mosquitto_pub -h localhost \
  -u backend -P backend_dev_password \
  -t robots/turtlebot3_01/cmd -m '{"command":"forward"}' -q 1

docker compose down
```

Next: [05 — ROS2 & Turtlebot3 Integration](05-ros2-integration.md) (Milestone 5) builds `ros_ws/`'s real `ROSAdapter` against actual ROS2 topics and a simulated Turtlebot3 in Gazebo, and changes exactly one block in `main.py` to start using it.
