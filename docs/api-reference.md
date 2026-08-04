# API & MQTT Reference

> **Reference material, not a numbered milestone doc.** The docs in [`docs/README.md`](README.md)'s reading order teach *why* each piece exists, in the order it was built; this page is the opposite kind of document — everything in one place, for looking something up while you're working, not for reading start to finish. Every shape here is pulled directly from the current code (`cloud-container/backend/app/`, `robot-container/robot_agent/topics.py`, `cloud-container/mosquitto/aclfile`) as of Milestone 10 — if it drifts from the code, the code wins; open an issue against this file, not the other way around.

## REST API

Base URL: `http://localhost:8000` locally (`API_BASE_URL` — see [`docs/02-docker-foundations.md`](02-docker-foundations.md)). All authenticated endpoints require `Authorization: Bearer <token>`, obtained from `POST /auth/login`. See [`docs/07-cloud-backend.md`](07-cloud-backend.md) for the auth/session design reasoning.

| Method & Path | Auth | Request body | Response | Notes |
|---|---|---|---|---|
| `GET /health` | none | — | `{status, service, mqtt_connected, timestamp}` | Unauthenticated on purpose — an orchestrator health check shouldn't need credentials. `status` is `"ok"` iff `mqtt_connected`. |
| `GET /metrics` | none | — | `{robots_known, robots_online, robots_in_use, mqtt_connected}` | Real fleet counts, not static placeholders. |
| `POST /auth/login` | none | `{username, password}` | `{access_token, token_type: "bearer", expires_in}` (`200`) or `401` | One shared operator credential (`OPERATOR_USERNAME`/`OPERATOR_PASSWORD`), constant-time compared. `expires_in` defaults to `JWT_EXPIRY_SECONDS` = 3600s. |
| `GET /robots` | bearer | — | `RobotSummary[]` | `RobotSummary = {robot_id, display_name, status: "online"\|"offline"\|"unknown", last_seen, battery_percentage, in_use_by}`. |
| `GET /robots/{id}` | bearer | — | `RobotDetail` (`200`) or `404` | `RobotDetail` = `RobotSummary` + `{telemetry, health}` (raw dicts, shapes below under MQTT `telemetry`/`health`). |
| `POST /robots/{id}/session` | bearer | — | `SessionInfo` (`200`), `404`, or `409` | Acquires the exclusive control session. `SessionInfo = {session_id, robot_id, operator, acquired_at, expires_at}`. `409` if another operator already holds it. |
| `DELETE /robots/{id}/session` | bearer | — | `204`, `404`, or `409` | Releases the session. `409` if the caller isn't the current holder. |
| `POST /robots/{id}/control` | bearer + **session** | `{command}` | `202 {"status": "sent"}`, `404`, or `403` | `command ∈ {forward, backward, left, right, stop}`. `403` if the caller doesn't hold the session. Renews the session on success. |
| `POST /robots/{id}/stop` | bearer | — | `202 {"status": "sent"}` or `404` | **Bypasses the session requirement** — any authenticated operator can always stop the robot. See `fleet/manager.py`'s `send_command()`. |
| `POST /robots/{id}/webrtc/offer` | bearer | `{sdp}` | `{sdp}` (`200`), `404`, or `504` | Relays a browser's SDP offer to the robot over MQTT and returns its answer. Does **not** require holding the session (watching video and driving are independent — see [`docs/00-overview.md`](00-overview.md)). `504` if the robot doesn't answer within 20s. |

## WebSocket API

Token travels as a `?token=<jwt>` query parameter (browsers can't set custom headers on the WS handshake) — see `app/auth/dependencies.py`.

### `WS /ws/teleop/{robot_id}`

Connecting **acquires** the control session (equivalent to `POST /robots/{id}/session`); a clean disconnect **releases** it. See [`docs/07-cloud-backend.md`](07-cloud-backend.md) for why this mirrors the robot's own MQTT Last-Will-and-Testament pattern.

| Direction | Message | Meaning |
|---|---|---|
| server → client | `{"status": "session_acquired", "robot_id"}` | Sent once, right after connecting. |
| client → server | `{"command": "forward"\|"backward"\|"left"\|"right"\|"stop"}` | Same five commands as the REST endpoint. Renews the session. |
| server → client | `{"status": "sent", "command"}` | Ack for a valid command. |
| server → client | `{"error": "<message>"}` | Invalid command, or the session was lost (e.g. TTL expiry) — client should re-acquire, not assume the command landed. |

### `WS /ws/status`

Read-only fleet dashboard feed. Pushes a full snapshot immediately on connect, then every 2 seconds (a deliberate periodic-push choice, not event-driven — see `ws/status.py`'s own docstring for why that's the right scope here).

| Direction | Message |
|---|---|
| server → client | `{"robots": RobotSummary[]}` (same shape as `GET /robots`) |

## MQTT Topics

Broker: Eclipse Mosquitto, `mosquitto:1883` internally / `localhost:1883` published. Every robot authenticates as **username = its own `robot_id`**; the backend authenticates as a single shared `backend` user. ACLs (`cloud-container/mosquitto/aclfile`) enforce every row below at the broker itself, independent of application code — see [`docs/03-mqtt-layer.md`](03-mqtt-layer.md) for the full reasoning, including why this boundary matters (a compromised backend still can't impersonate a robot's own telemetry).

| Topic | Direction | QoS | Retained | Payload |
|---|---|---|---|---|
| `robots/{id}/cmd` | backend → robot | 1 | no | `{"command": "forward"\|"backward"\|"left"\|"right"\|"stop", "issued_at": <ISO8601>}` |
| `robots/{id}/telemetry` | robot → backend | 0 | no | `{"robot_id", "timestamp": <epoch float>, "velocity": {"linear", "angular"}, "position": {"x", "y", "heading"}, "battery_percentage"}` |
| `robots/{id}/health` | robot → backend | 1 | no | `{"robot_id", "timestamp": <epoch float>, "cpu_percent", "memory_percent", "temperature_c", "mqtt_connected"}` |
| `robots/{id}/status` | robot → backend | 1 | **yes** | `{"robot_id", "status": "online"\|"offline", "timestamp": <epoch float>}`. Retained so a newly-connecting backend immediately knows the last-known state; published `"offline"` via MQTT's Last-Will-and-Testament if the robot disconnects uncleanly. |
| `robots/{id}/heartbeat` | robot → backend | 0 | no | `{"robot_id", "timestamp": <epoch float>, "status": "alive"}` |
| `robots/{id}/camera/offer` | backend → robot | 1 | no | `{"request_id": <uuid>, "sdp": <string>}` — SDP **signalling only**, never video bytes (those go over the separate WebRTC/DTLS-SRTP media path). |
| `robots/{id}/camera/answer` | robot → backend | 1 | no | `{"request_id": <uuid>, "sdp": <string>}` — `request_id` echoes the offer's; MQTT has no native request/response correlation, so this is hand-rolled (`webrtc/relay.py`). |

**ACL boundary, by role** (see `aclfile`):

| Role | `cmd` | `telemetry`/`health`/`status`/`heartbeat` | `camera/offer` | `camera/answer` |
|---|---|---|---|---|
| `backend` | write | **read-only** | write | **read-only** |
| robot (`%u` = its own `robot_id`) | **read-only** (own topic) | write (own topic) | **read-only** (own topic) | write (own topic) |

The asymmetry is the point: the backend can *originate* a command or an offer (things it's trusted to initiate on an operator's behalf) but can never *publish as if it were a robot* — every self-reported robot fact (status, telemetry, health, an SDP answer) can only ever come from that robot's own credentials.

## WebRTC signalling flow

Non-trickle (the robot's answer waits for full ICE gathering before responding — see [`docs/06-video-streaming.md`](06-video-streaming.md)), and requires TURN in practice (see [`docs/09-frontend.md`](09-frontend.md) for why STUN alone isn't enough against a real Chrome browser):

1. Browser creates a `recvonly` `RTCPeerConnection` (`iceServers` from runtime config — coturn TURN + a public STUN fallback), generates an SDP offer, waits for local ICE gathering to complete.
2. Browser: `POST /robots/{id}/webrtc/offer {sdp}`.
3. Backend (`webrtc/relay.py`): generates a `request_id`, publishes to `robots/{id}/camera/offer`, awaits a matching answer (`asyncio.Future`, 20s timeout).
4. Robot (`agent.py`'s `_on_camera_offer`): spins a background thread, calls `VideoStreamer.handle_offer(sdp)` — builds a **fresh** `webrtcbin` for this offer (see `_prepare_fresh_webrtcbin`), negotiates, waits for its own ICE gathering, publishes the answer to `robots/{id}/camera/answer`.
5. Backend resolves the pending future with the answer SDP, returns it as the HTTP response.
6. Browser applies the answer as its remote description; ICE connects (through the TURN relay in practice), DTLS-SRTP media starts flowing robot → browser.
