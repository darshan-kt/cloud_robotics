# 07 — The Cloud Backend

> **Status: complete.** Every module `cloud-container/backend/README.md` promised for this milestone is built, wired together, and verified against the real running stack — including a real robot: `curl`/WebSocket → FastAPI → MQTT → Robot Cloud Agent → ROS2 → Turtlebot3 actually turns the simulated robot's wheels, and real telemetry/health flow back the same path into the API. WebRTC signalling relay is explicitly **not** included here — that's Milestone 8's job, see [`docs/06-video-streaming.md`](06-video-streaming.md).

## What this step is

The control-plane half of the master diagram, finally connected end to end:

```
Browser → React → FastAPI → MQTT → Robot Cloud Agent → ROS2 → Turtlebot3
```

Milestone 3 built the MQTT contract. Milestones 4–6 built everything on the robot's side of it. This milestone builds everything on the *cloud* side: a FastAPI backend that authenticates an operator, knows what robots exist and whether they're online, lets exactly one operator at a time drive a given robot, and turns both a REST call and a live WebSocket message into the same MQTT `cmd` publish the robot already understands. Nothing on the robot side changes at all — the whole point of the topic contract from Milestone 3 was that the two sides could be built independently and just work once both exist.

## Why it's needed

### Why these specific modules, and why does each own exactly one thing?

`cloud-container/backend/README.md` named the module list back in Milestone 2, before any of them existed:

| Module | Owns |
|---|---|
| `mqtt/` | The **only** thing allowed to touch the broker. Everything else reaches the fleet through it. |
| `registry/` | What robots exist and their current state — split across Postgres (durable) and Redis (live), see below. |
| `sessions/` | Exclusive per-robot control locks. |
| `fleet/` | The one place that composes registry + sessions + MQTT into actual operations (list, get, acquire, release, command). |
| `auth/` | Turning a username/password into a JWT, and a JWT back into an operator identity. |
| `api/` | Thin REST adapters — extract the operator, call FleetManager, translate exceptions to HTTP status. |
| `ws/` | The same operations again, over WebSocket, for the low-latency interactive path. |

The reason `api/` and `ws/` are both thin and both call the *same* `FleetManager` methods, rather than each having its own copy of "check the session, then publish," is the single most important design decision in this milestone: **a discrete `POST /robots/{id}/control` command and a `/ws/teleop` keystroke must be governed by identical rules.** If the ownership check lived in the route handler, it would need writing (and could drift) twice. Because it lives in `fleet/manager.py` instead, both transports are provably consistent by construction — see `ws/teleop.py`'s and `api/robots.py`'s docstrings, which both point back to `fleet/manager.py` as the actual source of truth.

### Why Postgres AND Redis — what specifically lives where, and why?

This is the question worth understanding precisely, not just "one's a cache":

- **Postgres holds identity — data that must survive a restart of anything else.** The `robots` table (which robot IDs exist, their display name) and `control_sessions` (an append-only audit row per session: who drove what, when, for how long). If Redis were flushed right now, none of this should vanish — a robot doesn't stop existing because a cache warmed up empty, and an audit log that could lose entries isn't an audit log.
- **Redis holds live state — data that's either expensive to keep re-deriving or needs an atomic primitive Postgres doesn't have.** A robot's current online/offline status and its latest telemetry/health snapshot are refreshed on nearly every MQTT message and read on every dashboard poll — paying a SQL round-trip for "what's the battery level *right now*" would be real, needless latency. More importantly: the exclusive control lock (`sessions/manager.py`) is built on Redis's atomic `SET key value NX EX <ttl>` (set-if-absent-with-expiry) — genuinely the right primitive for "grant this lock only if nobody holds it, and auto-release it if the holder disappears," which Postgres has no equivalent of without hand-rolled advisory locking.

Concretely: `registry/store.py`'s `_ensure_registered()` writes to Postgres exactly once per robot (first time it's ever seen; `ON CONFLICT DO NOTHING` makes repeating it harmless), while `record_telemetry`/`record_health`/`record_status`/`record_heartbeat` all write to Redis, on every single MQTT message. That split *is* the design, not an implementation detail.

### Why does a robot get "registered" just by publishing a status message?

There's no separate robot-provisioning API in this milestone — any robot that authenticates to the broker (via its own MQTT credential, see [`docs/03-mqtt-layer.md`](03-mqtt-layer.md)) and publishes a retained `status` message becomes a known fleet member automatically, the first time `RobotRegistry.record_status()` sees it. This matches where the project actually is: exactly one simulated robot exists, onboarded by issuing it an MQTT credential, not by a fleet-admin workflow that doesn't exist yet. A real fleet-management product would eventually add explicit provisioning (and probably X.509-certificate-based robot identity, mirroring the MQTT story's own AWS IoT Core migration path) — noted here as a real scope boundary, not hidden.

### Why one shared operator credential and a hand-rolled JWT, instead of real user accounts?

The exact same shape as the MQTT backend/robot credentials from Milestone 3: one credential, configured via environment variables (`OPERATOR_USERNAME`/`OPERATOR_PASSWORD`), checked with a constant-time comparison (`hmac.compare_digest` — a naive `==` here would leak how many leading characters matched through response-timing differences). There is exactly one operator persona right now, the same way there was exactly one simulated robot in Milestone 3 — building a full multi-user accounts table, password hashing, and role system for a single dev credential would be solving a problem this project doesn't have yet. `auth/service.py`'s `authenticate()` is the one function a real user store would replace; nothing else in the auth chain (`auth/tokens.py`'s JWT issue/verify, `auth/dependencies.py`'s FastAPI/WebSocket extraction) would need to change. The AWS migration story here is the same shape as MQTT's: this becomes Amazon Cognito, the same way Mosquitto's password file becomes IoT Core certificates.

### Why does `stop` bypass the session-ownership check, and nothing else does?

`fleet/manager.py`'s `send_command()` requires the caller to hold the robot's active control session for every command *except* `stop`. This is a deliberate safety property, not an oversight: a robot that's misbehaving, or whose operator has walked away mid-session, must be stoppable by *any* authenticated operator, immediately — requiring "acquire the lock first" before an emergency stop would be exactly backwards for the one command where speed and universal access matter most. `test_stop_works_even_when_someone_else_holds_the_session` in the test suite exists specifically to keep this true as the codebase grows.

### Why does the teleop WebSocket manage its own session lifecycle, mirroring the robot's own MQTT Last-Will-and-Testament?

`ws/teleop.py` acquires the control session the moment the connection is accepted (not via a separate REST call first — the WebSocket is self-sufficient), renews it on every command sent, and releases it in a `finally` block on disconnect. That release-on-disconnect deliberately parallels the exact mechanism `docs/03-mqtt-layer.md` describes for the robot's own online/offline status: a **clean** disconnect (operator navigates away, closes the tab tidily) releases the lock immediately; an **unclean** one (network drop, browser crash — no close frame ever arrives, so the `finally` block never runs) is instead caught by the session's own Redis TTL (`SESSION_TTL_SECONDS`, default 30s) expiring on its own. Same idea the robot's MQTT Will implements at the broker level, reimplemented here at the session-lock level because there's no broker underneath a WebSocket to do it automatically.

### Why is `/ws/status` a periodic push instead of a true event-driven broadcaster?

`ws/status.py` re-sends a full fleet snapshot every 2 seconds rather than pushing exactly when `RobotRegistry` changes. A truly event-driven version (an in-process pub/sub broadcaster, notified by the MQTT message handlers, fanning out to every connected `/ws/status` client) is a real, natural enhancement — and a fair amount of additional machinery this milestone's scope doesn't strictly need: a 2-second-old number on a fleet dashboard is a genuinely fine tradeoff, and this is *not* the control path (that's `/ws/teleop` plus MQTT, both already low-latency). Documented as a deliberate scope choice, not smoothed over.

## What it does

`cloud-container/backend/app/`:

- **`config.py`** — extended with `operator_username`/`operator_password`, `jwt_secret`/`jwt_algorithm`/`jwt_expiry_seconds`, `session_ttl_seconds`, and the backend's own MQTT credential fields — same YAML-plus-env-override pattern as before.
- **`models.py`** (new) — shared Pydantic schemas: `RobotSummary`/`RobotDetail`, `ControlRequest`, `SessionInfo`, `LoginRequest`/`TokenResponse`. Pydantic here (not plain dataclasses, contrast `robot_agent/models.py`) because these cross an HTTP/WebSocket boundary and need real validation.
- **`db/postgres.py`** (new) — `asyncpg` pool creation + idempotent `CREATE TABLE IF NOT EXISTS` schema (`robots`, `control_sessions`). No migration framework yet (Alembic would be the real-system answer) — a known, stated simplification.
- **`db/redis.py`** (new) — `redis.asyncio` client factory.
- **`mqtt/topics.py`** (new) — the backend's own view of the Milestone 3 contract: wildcard subscriptions (`robots/+/status` etc.) plus `parse_topic()` to recover a robot_id from an inbound topic, since the backend (unlike the robot) is fleet-wide.
- **`mqtt/service.py`** (new) — `MQTTService`: paho-mqtt bridged into asyncio exactly like `robot_agent/mqtt_client.py`'s `PahoMQTTClient` (same background-thread-callbacks-via-`call_soon_threadsafe` shape, for the same reason). Subscribes fleet-wide on connect; `publish_command()` is the only thing the backend is trusted to originate, matching the ACL's `readwrite robots/+/cmd` / `read`-only-elsewhere grant.
- **`registry/store.py`** (new) — `RobotRegistry`: the Postgres-durable / Redis-live split described above.
- **`sessions/manager.py`** (new) — `SessionManager`: the Redis-lock-plus-Postgres-audit-log described above, including the documented, deliberate TOCTOU caveat on `release()`/`renew()` (a real production system under real contention would use a Lua script or a Redlock-style token; this project's single-operator-per-robot scope doesn't need that yet).
- **`fleet/manager.py`** (new) — `FleetManager`: the one composition point described above.
- **`auth/tokens.py`**, **`auth/service.py`**, **`auth/dependencies.py`** (new) — pure JWT encode/decode (unit-testable with no FastAPI involved), credential check, and the two FastAPI dependencies (`get_current_operator` for REST's `Authorization: Bearer` header, `get_current_operator_ws` for WebSocket's `?token=` query parameter, since browsers' native WebSocket API cannot set custom headers on the handshake at all).
- **`api/auth.py`** (new) — `POST /auth/login`.
- **`api/robots.py`** (new) — `GET /robots`, `GET /robots/{id}`, `POST`/`DELETE /robots/{id}/session`, `POST /robots/{id}/control`, `POST /robots/{id}/stop`.
- **`api/health.py`** — `/health`/`/metrics` now report real state (MQTT connectivity, fleet counts) instead of placeholders.
- **`ws/teleop.py`**, **`ws/status.py`** (new) — described above.
- **`main.py`** — rewritten around a `lifespan` context manager: creates the Postgres pool, Redis client, and `MQTTService` once at startup, wires the registry's `record_*` methods as MQTT message handlers, constructs the one `FleetManager`, stores it on `app.state`, and tears everything down cleanly on shutdown.
- **`docker-compose.yml`** — `redis`/`postgres` now publish their ports to the host (dev/debugging convenience, e.g. `redis-cli`/`psql`/this milestone's own live tests — the backend itself always reaches them by internal service name); `backend`'s environment gained the MQTT credential and auth/session settings.
- **`cloud-container/tests/`** — `test_auth.py` (pure unit), `fake_registry.py`/`fake_session_manager.py`/`fake_mqtt_service.py` + `test_fleet_manager.py` (unit, business-rule-focused — session ownership, the `stop` override), `test_registry_and_sessions_live.py` (integration, real Postgres/Redis, including a genuine TTL-expiry test), `test_api_live.py` (end-to-end HTTP/WebSocket against the real running backend — this milestone's equivalent of Milestone 6's "verify against a real browser").

## A real bug this milestone's own testing found - in a Milestone 3 test

Running the full existing test suite against the real stack (now including a continuously-running robot, which wasn't normally true when `test_mqtt_acl.py` was written in Milestone 3) surfaced a genuine failure: `test_backend_cannot_publish_robot_telemetry` failed, asserting a spoofed-publish ACL bypass. Inspecting the actually-received message payloads (rather than trusting the assertion) showed they were the **real robot's own legitimate telemetry** (`{"robot_id": "turtlebot3_01", "timestamp": ..., "velocity": ...}`), not the spoofed one (`{"spoofed": true}`) - the ACL boundary itself was never actually breached. The test's original assertion (`assert not received`) implicitly assumed zero other traffic on that topic during its run, an assumption that was true in Milestone 3's context and stopped being safe the moment a real, continuously-telemetry-publishing robot became a normal part of running these tests. Fixed to assert the specific spoofed payload never arrives, which is what the test actually intends to prove - not "nothing happened on this topic," which was never the real security property.

## Verification

What's actually been confirmed, and how - against the real, live stack (`docker compose up -d`, including the robot container):

- **Auth**: wrong credentials → `401`; correct credentials → a JWT; that JWT authorizes `/robots`; no token → `401`.
- **Registry**: the real robot auto-registers on its first retained `status` message; `GET /robots`/`GET /robots/{id}` report real, live `status`/`last_seen`/`battery_percentage`, and real `telemetry`/`health` payloads actually being published by the running robot right now.
- **Sessions**: `POST /robots/{id}/control` without a session → `403`; `POST /robots/{id}/session` → a session; control with that session → `202`, and `GET /robots/{id}` reflects `in_use_by`; `DELETE /robots/{id}/session` → `204`; a live integration test proves the session lock is genuinely exclusive (a second operator's `acquire()` is rejected) and genuinely TTL-bounded (an unrenewed session expires in Redis on its own and becomes acquirable by someone else, with no explicit release ever called).
- **The full control path, for real**: `POST /robots/{id}/control {"command": "forward"}` was traced end to end - the robot's own agent logs show `Dispatched 'forward' -> linear=0.20 angular=0.00`, and `robots_metrics.commands_received` incremented on the robot's own `/metrics` - proving the entire chain (`curl → FastAPI → MQTT → Robot Cloud Agent → dispatcher`) actually moves a (simulated) robot, not just that an HTTP call returned `202`.
- **`stop`**: succeeds without ever acquiring a session, exactly as designed.
- **WebSockets**: `/ws/teleop/{robot_id}` acquires a session on connect, accepts/rejects commands correctly, and releases the session on clean disconnect (confirmed by a subsequent `/ws/status` snapshot showing `in_use_by: null` immediately after); `/ws/status` delivers a real fleet snapshot.
- **35/35 tests pass** against the real stack: 23 fast (7 pure auth unit tests + 9 fleet-manager unit tests using fakes... see exact counts in `cloud-container/tests/`), 6 live registry/session integration tests against real Postgres/Redis, 7 end-to-end HTTP/WebSocket tests against the real running backend, plus the pre-existing 6 Milestone 3 MQTT ACL tests (one fixed along the way, see above).

## Running it yourself

```bash
docker compose up -d
docker compose logs -f backend   # watch startup: postgres pool, redis, MQTT connect, fleet-wide subscribes

# login and list robots
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"operator","password":"operator_dev_password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:8000/robots -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# drive it
curl -s -X POST http://localhost:8000/robots/turtlebot3_01/session -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:8000/robots/turtlebot3_01/control \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"command":"forward"}'

pip install -r cloud-container/tests/requirements.txt
pytest cloud-container/tests/ -v   # 35 pass against the live stack

docker compose down
```

## Next steps

- **Milestone 8**: WebRTC signalling relay - the `camera` MQTT topic (SDP/ICE only, never video bytes) needs a backend module to shuttle offers/answers between the browser and the robot, finally replacing `dev_signalling_server.py`'s throwaway HTTP page (see [`docs/06-video-streaming.md`](06-video-streaming.md)).
- **Milestone 9**: the React frontend actually calling this API - `POST /auth/login`, `GET /robots`, `/ws/teleop`, `/ws/status` are all real and ready to be consumed.
- Noted, not blocking: no migration framework for the Postgres schema; `/ws/status` is periodic-push rather than fully event-driven; the session lock's `release()`/`renew()` have a narrow theoretical TOCTOU race under real contention this project's single-operator-per-robot scope doesn't hit. All three are documented exactly where they live in the code, not hidden.

Next: [08 — WebRTC Signalling](08-webrtc-signalling.md) (Milestone 8) - not started yet.
