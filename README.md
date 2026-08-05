# Cloud Robotics Platform

A local, Docker-based simulation of a **production cloud robotics platform** — a browser-based fleet operator console that tele-operates a ROS2 robot (Turtlebot3 in Gazebo) over MQTT, with live video over WebRTC and a live LiDAR scan panel alongside it.

It is built to run entirely on one machine today and move to AWS later **without an architectural rewrite** — only endpoints change (`localhost` → real AWS service addresses). See [`docs/00-overview.md`](docs/00-overview.md) for why the system is shaped the way it is, and [`docs/11-aws-migration.md`](docs/11-aws-migration.md) for the concrete migration path.

## New here? Start with the docs

This repository is being built **milestone by milestone**, and every milestone gets a companion doc in [`docs/`](docs/) written to teach the concept, not just describe the code. Read them in order — they're numbered for that reason. Start at [`docs/README.md`](docs/README.md). Looking something up rather than reading start to finish? See [`docs/api-reference.md`](docs/api-reference.md) for every REST/WebSocket/MQTT contract in one place.

## Architecture at a glance

**Command path** (browser → robot):

```
Browser → React → FastAPI → MQTT → Robot Cloud Agent → ROS2 → Turtlebot3
```

**Video path** (robot → browser):

```
Camera → ROS2 → GStreamer → WebRTC → Browser
```

Two containers, two clear responsibilities:

| Container | Responsibility |
|---|---|
| `robot-container/` | Everything that must live next to the robot: ROS2, the simulated Turtlebot3, and the Robot Cloud Agent that bridges ROS2 to the cloud. Never exposed directly to the browser. |
| `cloud-container/` | Everything the fleet operator touches: the FastAPI backend, the MQTT broker, Redis, PostgreSQL, and the React frontend. **Never talks to ROS2 directly** — only MQTT. |

## Repository layout

```
cloud-robotics/
├── docs/              # Numbered learning docs — read these first
├── robot-container/   # ROS2 + Turtlebot3 + Robot Cloud Agent
└── cloud-container/   # FastAPI + MQTT broker + Redis + Postgres + React
```

See [`docs/01-repository-structure.md`](docs/01-repository-structure.md) for a full walkthrough of every folder and why it exists.

## Build roadmap

This is being implemented one milestone at a time. Each milestone is reviewed and runnable before the next begins.

- [x] 1. Repository structure & docs framework
- [x] 2. Docker setup (compose file, Dockerfiles, minimal bootable services)
- [x] 3. MQTT layer (broker config, topic contracts, pub/sub tests)
- [x] 4. Robot Cloud Agent core (config, logging, DI, MQTT client, heartbeat, health, watchdog)
- [x] 5. ROS2 + Turtlebot3 + Gazebo integration (real `ROSAdapter`)
- [x] 6. Camera pipeline: GStreamer H264 → WebRTC (real video, verified live in a real browser — see below)
- [x] 7. Cloud Backend (FastAPI modules, Redis + PostgreSQL — verified against a real robot, see below)
- [x] 8. WebRTC signalling (real, MQTT-mediated — replaced the throwaway dev HTTP server, verified with a real browser, see below)
- [x] 9. Frontend (React + TypeScript + Tailwind, keyboard teleop — verified against a real, unmodified Chrome browser, see below)
- [x] 10. Full end-to-end integration + test suite (80/80 tests, one command — see below)
- [x] 11. Final documentation pass (diagrams, API/MQTT reference, deployment & AWS migration guides — see below)

## Running it

There's a `Makefile` wrapping every command below — run `make` (or `make help`) at any time to see the full list. Every target is just a named shortcut for the raw `docker compose`/`pytest` command shown next to it, so use whichever you prefer.

### Prerequisites

- Docker + Docker Compose v2 (`docker compose version`)
- ~6GB free RAM for the full stack (Gazebo is the heavy one — see the resource limits on the `robot` service in `docker-compose.yml` if you're on a tighter machine)
- A real Chrome/Chromium browser to drive the console (the video path specifically needs a real browser's WebRTC stack — see [`docs/09-frontend.md`](docs/09-frontend.md))
- Nothing else — Postgres, Redis, Mosquitto, ROS2, Gazebo, and GStreamer all live inside the containers. You don't install any of them yourself.

### 1. Configure

```bash
make setup                # copies .env.example -> .env if it doesn't exist yet
# or by hand:
cp .env.example .env
```

Every value in `.env` has a working default — this step is here so credentials/ports live in one file you can edit, not because you *must* change anything before the first run. See the comments in `.env.example` for what each variable does.

### 2. Build and start the stack

```bash
make up                   # docker compose up -d --build, then waits for health checks
```

This builds and starts all **7 services**: `mosquitto` (MQTT broker), `redis`, `postgres`, `coturn` (WebRTC TURN relay), `backend` (FastAPI), `frontend` (React), and `robot` (ROS2 + Gazebo + the Robot Cloud Agent). The first run takes a few minutes (Gazebo/GStreamer base images are large); later runs reuse Docker's build cache and are fast.

When it prints "Stack is up," everything is healthy and the console is ready at **http://localhost:3000**.

### 3. Verify everything is healthy

```bash
make ps        # docker compose ps - every service should show (healthy) or Up
make health    # curl's the backend, robot, and frontend health endpoints
```

```bash
$ make health
Backend:  {"status":"ok","service":"cloud-robotics-backend","mqtt_connected":true,...}
Robot:    {"status": "ok", "robot_id": "turtlebot3_01", "mqtt_connected": true, ...}
Frontend: HTTP 200
```

### 4. The simulation

The `robot` service brings up a real ROS2 (Humble) + Gazebo simulation of a Turtlebot3 automatically as part of starting the container — there's no separate "launch the simulation" step. It runs **headless** (`gzserver` only, no `gzclient` GUI window) by design: the operator is meant to see the robot the same way they would a real one, through its camera feed in the browser, not through a 3D simulator window. `make logs SERVICE=robot` shows Gazebo, the ROS2 nodes, and the Robot Cloud Agent's own startup log in one stream.

The robot starts driving as soon as a `cmd` MQTT message reaches it — you don't need the camera working to command it (see step 7).

### 5. Watching the simulation visually (optional)

Headless-by-default (step 4) is the right choice for what actually ships, but it's genuinely useful during development to *see* the physics simulation move as you drive it — not instead of the camera feed, alongside it. `docker-compose.gui.yml` is an opt-in override that passes your host's X11 display into the robot container so Gazebo's own GUI (`gzclient`) can attach to the already-running simulation:

```bash
xhost +local:docker      # one-time per session: let local containers reach your X server
make up-gui              # recreates the robot container with the X11 socket mounted
make gzclient             # opens the Gazebo GUI window, attached to the live sim
```

A window opens on your actual desktop showing the Turtlebot3 in its world — drive it from the web console (step 7) and watch it move in both places at once. Needs a real X11 (or XWayland) display on the host; doesn't work over a plain SSH session without `-X`. Combine with a camera source in one command: `CAMERA_TEST_PATTERN_FALLBACK=true make up-gui`. Close the window and `make gzclient` again any time — it's just attaching a viewer, not restarting the simulation underneath it.

### 6. Camera & video

Video is real WebRTC (H264 over `webrtcbin`/GStreamer on the robot side), not a placeholder — but it needs *something* feeding `/camera/image_raw`. Three ways to run it, pick one:

| Command | What it does |
|---|---|
| `make up` (default) | No camera source. This is the honest, safe default — a real deployment with no camera should fail loudly (repeated `No camera at '/dev/video0'` warnings in `make logs SERVICE=robot`, zero video frames), not silently fake it. Everything else (teleop, telemetry, dashboard) works fine. **If you don't have a physical webcam attached (check with `ls /dev/video*`), this is why the Robot page's video never leaves "negotiating" — that's expected, not broken. Use one of the two modes below instead.** |
| `make up-test-pattern` | A synthetic animated test pattern feeds the pipeline instead — no physical webcam needed. Use this to see the WebRTC video path actually work on a machine with no camera (a dev laptop, a CI runner, this project's own test suite). |
| `make up-camera` | Passes your **real, physical webcam** (`/dev/video0` by default — override `CAMERA_DEVICE` in `.env`, list yours with `ls /dev/video*`) through to the robot container. This is the real thing: your webcam's actual feed becomes the "robot's camera," streamed live over WebRTC to the browser. |

Switching modes later without a full restart: `CAMERA_TEST_PATTERN_FALLBACK=true make restart-robot` (or edit `.env` and `make restart-robot`). Once a camera source is running, confirm frames are actually flowing before blaming the browser: `curl http://localhost:8080/metrics` — `camera_frames_received` should be climbing.

**`CAMERA_DEVICE` must be a `/dev/videoN` capture node, not `/dev/mediaN`.** Modern UVC webcam drivers register both: `/dev/media0` is a *media controller* node (pipeline topology only — not something OpenCV's V4L2 backend, which `webcam_driver.py` uses, can capture frames from), while `/dev/video0` (sometimes `/dev/video1`+ too, for metadata) is the actual capture device. `v4l2-ctl --device=/dev/video0 --list-formats-ext` (install `v4l2-utils` if you don't have it) confirms which node and resolutions/framerates your camera really supports — match `CAMERA_WIDTH`/`CAMERA_HEIGHT`/`CAMERA_FPS` in `.env` to one of the listed "Discrete" sizes.

### 7. Log in and drive the robot

1. Open **http://localhost:3000** (`make open`, or just click it).
2. Log in — the dev credentials are `operator` / `operator_dev_password` (`OPERATOR_USERNAME`/`OPERATOR_PASSWORD` in `.env`).
3. **Dashboard** — your one robot (`turtlebot3_01` by default) appears live, pushed over a WebSocket every 2 seconds. Click it.
4. **Robot page** — the live video connects automatically (if a camera source is running — see step 6); watch its connection status go `negotiating` → `connected`.
5. Click **Take control** to acquire the exclusive teleop session (see [`docs/07-cloud-backend.md`](docs/07-cloud-backend.md) for what that actually locks). The teleop status turns `connected`.
6. Drive it: click-and-hold the on-screen arrow buttons, or use the **arrow keys / WASD** on your keyboard — both are throttled to 20 commands/sec while held, and stop the instant you release. Watch the telemetry panel (velocity, position) update in real time.
7. **Emergency Stop** always works, even without holding control — it's a deliberate safety override (see `fleet/manager.py`'s `send_command()`).
8. **Release control** when you're done so another operator (or your own next session) can take over. Check **Health** and **Settings** in the nav bar while you're in there.

### 8. Everyday commands

```bash
make logs                     # tail every service's logs
make logs SERVICE=robot       # tail just one
make restart-robot            # recreate only the robot container (e.g. after editing .env)
make token                    # fetch a fresh operator JWT for curl'ing the API by hand
make down                     # stop everything - Postgres/Redis/Mosquitto data survives
make clean                    # stop AND wipe volumes (fresh-start data)
make prune                    # reclaim disk space (dangling images/build cache)
```

### 9. Running the tests

```bash
make test              # the FULL suite: robot + backend + a real-browser frontend E2E run - 80 tests, one command
make test-robot         # just the robot_agent unit tests
make test-cloud         # just backend + frontend E2E (needs the stack already up)
```

See [`docs/10-testing-strategy.md`](docs/10-testing-strategy.md) for what each layer actually proves and why a real Chrome browser is involved, not a mock.

No real robot behavior without the stack running — see [Status](#status) below and [`docs/02-docker-foundations.md`](docs/02-docker-foundations.md) for exactly what does and doesn't work today.

## Status

**All 11 planned milestones complete, plus a real post-completion feature: live LiDAR.** This project is now what its first line always said it would be: a local, Docker-based simulation of a production cloud robotics platform, built end to end and verified for real at every layer — not a demo that only looks right, and not scaffolding waiting to be filled in.

**LiDAR** (post-Milestone-11) follows the exact same pattern as every other real feature here: the Turtlebot3's simulated LDS-01 (`/scan`) flows Robot Cloud Agent → MQTT (`robots/{id}/lidar`, a new topic, same ACL shape as telemetry) → FastAPI (`RobotDetail.lidar`, same registry pattern as telemetry/health) → a new `LidarView` canvas panel on the Robot page, visible alongside the camera feed and teleop controls exactly as asked. Building it surfaced two more real bugs, fixed at the root, not papered over: ROS2's `inf` ("nothing detected") isn't valid JSON and would have crashed `JSON.parse()` on arrival - now converted to `null` at the source; and heavier WebRTC reconnect cycling while iterating on the panel exposed a genuine GStreamer pad-unlinking race that Milestone 9's own reconnect fix had only narrowed, not closed (confirmed via a dedicated 16-reconnect stress test: 14 failures before the fix, 0 after). See [`docs/09-frontend.md`](docs/09-frontend.md) for the full story and [`docs/api-reference.md`](docs/api-reference.md) for the `lidar` topic contract.

**Milestone 11** added the pieces that only make sense once everything else is real: [`docs/00-overview.md`](docs/00-overview.md) now carries actual Mermaid architecture/sequence diagrams (not ASCII sketches) of the topology Milestones 1-10 actually built; [`docs/api-reference.md`](docs/api-reference.md) consolidates every REST endpoint, WebSocket message, and MQTT topic into one lookup doc, cross-checked line-by-line against the current code rather than transcribed from memory; and [`docs/11-aws-migration.md`](docs/11-aws-migration.md) is the concrete, service-by-service AWS migration guide `docs/00-overview.md` has pointed to since Milestone 1 — honest about being a verified *design*, not an executed deployment (no AWS resources were provisioned; the doc says so plainly).

**Milestone 10** built the permanent test suite: `./scripts/run-integration-tests.sh` runs all three containers' tests — **80/80 pass** (32 robot, 48 cloud) — against a live stack in one command, including a real, unmodified Chrome browser (via Playwright) driving the actual frontend through the actual backend to the actual robot. Building it surfaced a real gap (5 robot tests were silently skipped, not run, because `pytest.ini` never reached the container) and fixed it, not just noted it.

**Milestone 9** built the React frontend for real: login, live dashboard, decoding WebRTC video, arrow-button/keyboard teleop, emergency stop — and verifying it against a real browser surfaced two genuine WebRTC bugs (Chrome's mDNS-obfuscated ICE candidates; a shared `webrtcbin` silently breaking reconnects), both fixed at the root rather than worked around. See [`docs/09-frontend.md`](docs/09-frontend.md).

Milestones 1-8 (repo structure, Docker foundations, MQTT layer, Robot Cloud Agent, ROS2/Gazebo integration, WebRTC video streaming, the FastAPI backend, and MQTT-mediated WebRTC signalling) remain complete and unaffected — see [`docs/README.md`](docs/README.md) for the full reading order, each doc still describing exactly what it did and why.

**What's next is genuinely optional, not deferred work**: see [`docs/11-aws-migration.md`](docs/11-aws-migration.md)'s own "Next steps" for what a real production deployment would still need (actually provisioning the AWS infrastructure this guide describes, real per-operator accounts, CI/CD, multi-robot fleet testing) — none of it blocks calling this local simulation done.