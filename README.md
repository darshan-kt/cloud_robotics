# Cloud Robotics Platform

A local, Docker-based simulation of a **production cloud robotics platform** — a browser-based fleet operator console that tele-operates a ROS2 robot (Turtlebot3 in Gazebo) over MQTT, with live video over WebRTC.

It is built to run entirely on one machine today and move to AWS later **without an architectural rewrite** — only endpoints change (`localhost` → real AWS service addresses). See [`docs/00-overview.md`](docs/00-overview.md) for why the system is shaped the way it is, and [`docs/11-aws-migration.md`](docs/11-aws-migration.md) (once written) for the concrete migration path.

## New here? Start with the docs

This repository is being built **milestone by milestone**, and every milestone gets a companion doc in [`docs/`](docs/) written to teach the concept, not just describe the code. Read them in order — they're numbered for that reason. Start at [`docs/README.md`](docs/README.md).

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
- [ ] 2. Docker setup (compose file, Dockerfiles, minimal bootable services)
- [ ] 3. MQTT layer (broker config, topic contracts, pub/sub tests)
- [ ] 4. Robot Cloud Agent core (config, logging, DI, MQTT client, heartbeat, health, watchdog)
- [ ] 5. ROS2 + Turtlebot3 + Gazebo integration (real `ROSAdapter`)
- [ ] 6. Camera pipeline: GStreamer H264 → WebRTC
- [ ] 7. Cloud Backend (FastAPI modules, Redis + PostgreSQL)
- [ ] 8. WebRTC signalling
- [ ] 9. Frontend (React + TypeScript + Tailwind, keyboard teleop)
- [ ] 10. Full end-to-end integration + test suite
- [ ] 11. Final documentation pass (diagrams, API/MQTT reference, deployment & AWS migration guides)

## Status

**Milestone 1 complete.** No services run yet — this milestone only lays down structure and documentation. `docker compose up` arrives in Milestone 2.
