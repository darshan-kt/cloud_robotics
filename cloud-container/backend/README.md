# cloud-container/backend/

**Purpose:** the FastAPI application — the only cloud-side component allowed to reach the robot, and only via MQTT (never ROS2).

**Contains**, each as its own module (single responsibility, dependency-injected — see [`docs/07-cloud-backend.md`](../../docs/07-cloud-backend.md) for the full reasoning):
- `auth/` — JWT-based operator sessions (`tokens.py` encode/decode, `service.py` credential check, `dependencies.py` FastAPI/WebSocket extraction)
- `fleet/` — fleet manager: the one place REST and WebSocket both route through, so a command sent either way is governed by identical rules
- `registry/` — robot registry: Postgres for durable identity (which robots exist), Redis for live state (status/telemetry/health)
- `sessions/` — exclusive per-robot control sessions: a Redis TTL lock plus a Postgres audit log, mirroring the robot's own MQTT Last-Will-and-Testament pattern
- `api/` — REST endpoints (`POST /auth/login`, `GET /robots`, `GET /robots/{id}`, `POST`/`DELETE /robots/{id}/session`, `POST /robots/{id}/control`, `POST /robots/{id}/stop`, `POST /robots/{id}/webrtc/offer`, `GET /health`, `GET /metrics`)
- `ws/` — WebSocket endpoints (`/ws/teleop/{robot_id}`, `/ws/status`)
- `mqtt/` — the only module that talks to the broker (fleet-wide subscriptions, command publish, WebRTC offer publish)
- `webrtc/` — WebRTC signalling relay: shuttles an SDP offer/answer between a browser and a robot over MQTT (`camera/offer`/`camera/answer`), correlated by a hand-rolled `request_id` since MQTT has no built-in request/response — see [`docs/08-webrtc-signalling.md`](../../docs/08-webrtc-signalling.md)
- `config.py` — configuration loader (YAML + env vars)
- `logging_config.py` — structured JSON logging setup
- `db/` — Postgres pool + schema, Redis client factory

**Filled in:** Milestone 7 (every module above except `webrtc/`), Milestone 8 (`webrtc/` — WebRTC signalling).
