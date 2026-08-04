# Cloud Robotics Platform

A local, Docker-based simulation of a **production cloud robotics platform** — a browser-based fleet operator console that tele-operates a ROS2 robot (Turtlebot3 in Gazebo) over MQTT, with live video over WebRTC.

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

## Quick start

```bash
docker compose up -d      # builds and starts all 7 services
docker compose ps         # check health status
curl http://localhost:8000/health
open http://localhost:3000     # or just visit it in a browser
docker compose logs -f robot   # watch the robot's MQTT heartbeat
docker compose down       # stop everything (data volumes persist)
```

No real robot behavior yet — see [Status](#status) below and [`docs/02-docker-foundations.md`](docs/02-docker-foundations.md) for exactly what does and doesn't work today.

## Status

**All 11 planned milestones complete.** This project is now what its first line always said it would be: a local, Docker-based simulation of a production cloud robotics platform, built end to end and verified for real at every layer — not a demo that only looks right, and not scaffolding waiting to be filled in.

**Milestone 11** (this one) added the pieces that only make sense once everything else is real: [`docs/00-overview.md`](docs/00-overview.md) now carries actual Mermaid architecture/sequence diagrams (not ASCII sketches) of the topology Milestones 1-10 actually built; [`docs/api-reference.md`](docs/api-reference.md) consolidates every REST endpoint, WebSocket message, and MQTT topic into one lookup doc, cross-checked line-by-line against the current code rather than transcribed from memory; and [`docs/11-aws-migration.md`](docs/11-aws-migration.md) is the concrete, service-by-service AWS migration guide `docs/00-overview.md` has pointed to since Milestone 1 — honest about being a verified *design*, not an executed deployment (no AWS resources were provisioned; the doc says so plainly).

**Milestone 10** built the permanent test suite: `./scripts/run-integration-tests.sh` runs all three containers' tests — **80/80 pass** (32 robot, 48 cloud) — against a live stack in one command, including a real, unmodified Chrome browser (via Playwright) driving the actual frontend through the actual backend to the actual robot. Building it surfaced a real gap (5 robot tests were silently skipped, not run, because `pytest.ini` never reached the container) and fixed it, not just noted it.

**Milestone 9** built the React frontend for real: login, live dashboard, decoding WebRTC video, arrow-button/keyboard teleop, emergency stop — and verifying it against a real browser surfaced two genuine WebRTC bugs (Chrome's mDNS-obfuscated ICE candidates; a shared `webrtcbin` silently breaking reconnects), both fixed at the root rather than worked around. See [`docs/09-frontend.md`](docs/09-frontend.md).

Milestones 1-8 (repo structure, Docker foundations, MQTT layer, Robot Cloud Agent, ROS2/Gazebo integration, WebRTC video streaming, the FastAPI backend, and MQTT-mediated WebRTC signalling) remain complete and unaffected — see [`docs/README.md`](docs/README.md) for the full reading order, each doc still describing exactly what it did and why.

**What's next is genuinely optional, not deferred work**: see [`docs/11-aws-migration.md`](docs/11-aws-migration.md)'s own "Next steps" for what a real production deployment would still need (actually provisioning the AWS infrastructure this guide describes, real per-operator accounts, CI/CD, multi-robot fleet testing) — none of it blocks calling this local simulation done.