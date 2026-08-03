# cloud-container/backend/

**Purpose:** the FastAPI application — the only cloud-side component allowed to reach the robot, and only via MQTT (never ROS2).

**Will contain**, each as its own module (single responsibility, dependency-injected):
- `auth/` — authentication (JWT-based operator sessions)
- `fleet/` — fleet manager (multi-robot orchestration logic)
- `registry/` — robot registry (known robots, their metadata, online/offline state)
- `sessions/` — session manager (operator ↔ robot teleop sessions)
- `api/` — REST endpoints (`GET /robots`, `GET /robots/{id}`, `POST /robots/{id}/control`, `POST /robots/{id}/stop`, `GET /health`, `GET /metrics`)
- `ws/` — WebSocket endpoints (`/teleop`, `/status`)
- `mqtt/` — MQTT service (the only module that talks to the broker)
- `webrtc/` — WebRTC signalling relay
- `config/` — configuration loader (YAML + env vars)
- `logging/` — structured JSON logging setup

**Filled in:** Milestone 7 (core modules + REST/WebSocket API), Milestone 8 (WebRTC signalling).
