# cloud-container

Everything the fleet operator touches: the FastAPI backend, the MQTT broker, Redis, PostgreSQL, and the React frontend. In production this is what runs in AWS.

**This container never talks to ROS2.** It only reaches the robot through MQTT. See the root [`README.md`](../README.md) and [`docs/00-overview.md`](../docs/00-overview.md) for why.

## Layout

| Folder | Purpose |
|---|---|
| [`backend/`](backend/) | FastAPI app: auth, fleet manager, robot registry, session manager, robot REST API, MQTT service, WebRTC signalling, health/metrics, config, logging. |
| [`frontend/`](frontend/) | React + TypeScript + Tailwind operator console (Dashboard, Robot, Settings, Health). |
| [`mosquitto/`](mosquitto/) | MQTT broker configuration — listeners, auth, per-robot ACLs. |
| [`docker/`](docker/) | Dockerfiles for the backend and frontend images. |
| [`config/`](config/) | YAML configuration (ports, database URLs, Redis address, JWT settings). |
| [`docs/`](docs/) | Cloud-side implementation notes. |
| [`tests/`](tests/) | Backend unit, API integration, and MQTT integration tests. |

Status: scaffolding only (Milestone 1). Build details land starting Milestone 2.
