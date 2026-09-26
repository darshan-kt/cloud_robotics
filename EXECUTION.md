# Execution guide

How to run the two applications in this repository, what credentials they take,
and what you should see when they work.

They are **independent**. Neither needs the other running. ROBOSTORE has no
backend at all; Cloud Robotics is the full seven-service platform.

| | [Cloud Robotics](#1-cloud-robotics) | [ROBOSTORE](#2-robostore) |
|---|---|---|
| What it is | Fleet teleoperation platform — real MQTT, ROS 2, WebRTC video | Demo app-store console (POC) |
| Directory | `cloud-container/` + `robot-container/` | `robostore-poc/` |
| Services | 7 containers (9 with the fleet overlay) | 1 container, or plain `npm run dev` |
| Backend | FastAPI + Postgres + Redis + Mosquitto | none — client-side only |
| Start | `make up` | `make robostore-up` |
| Console | http://localhost:3000 | http://localhost:3100 |
| Sign in | `operator` / `operator_dev_password` | any email + any 6+ digit password |
| RAM | ~6 GB | ~200 MB |
| First build | several minutes (ROS 2 + Gazebo images are large) | ~30 seconds |

> **Ports on this machine are shifted.** The tables below give the shipped
> defaults. This particular machine runs Cloud Robotics on **3300 / 8200**
> because another project (`agribot_store`) already holds 3000 and 8000 — see
> [Port overrides](#port-overrides). The GIFs below were recorded on this
> machine, so they show `:3300`. `make up` always prints the URLs it actually
> bound; trust that over any document.

---

## 1. Cloud Robotics

The real platform: a browser drives a physical (or simulated) robot over MQTT,
with live telemetry, a LIDAR view and WebRTC video.

### Prerequisites

- Docker + Docker Compose v2 (`docker compose version`)
- ~6 GB free RAM — Gazebo is the heavy one
- A Chromium-based browser for the video path (real WebRTC stack needed)

Nothing else. Postgres, Redis, Mosquitto, ROS 2, Gazebo and GStreamer all live
inside the containers.

### Run it

```bash
cd cloud-robotics

make setup     # copies .env.example -> .env (only if .env does not exist)
make up        # build + start all 7 services, wait for health checks
```

First run pulls and builds the ROS 2 / Gazebo images and takes several minutes.
Later runs reuse the build cache.

When it finishes it prints the URLs it bound:

```
Stack is up:
  Console:  http://localhost:3000  (login: operator / operator_dev_password)
  Backend:  http://localhost:8000/health
  Robot:    http://localhost:8080/health
```

### Credentials

| What | Value | Where it is set |
|---|---|---|
| Operator username | `operator` | `OPERATOR_USERNAME` in `.env` |
| Operator password | `operator_dev_password` | `OPERATOR_PASSWORD` in `.env` |
| Postgres | `robotics` / `robotics_dev_password` | `POSTGRES_USER` / `POSTGRES_PASSWORD` |
| Redis | `redis_dev_password_change_me` | `REDIS_PASSWORD` |
| MQTT — backend | `backend` / `backend_dev_password` | `MQTT_BACKEND_*` |
| MQTT — robots | one password per robot | `MQTT_ROBOT_CREDENTIALS` |
| TURN relay | `turnuser` / `turn_dev_password` | `TURN_*` |

These are development defaults and are committed on purpose so `make up` works
with no configuration. **They are all rejected at startup when
`ENVIRONMENT=production`** — see `assert_production_safe()` in
`cloud-container/backend/app/config.py`. Nothing here is a secret; treat the
whole file as public.

### What you should see

![Cloud Robotics walkthrough](docs/images/cloud-robotics-walkthrough.gif)

*Sign in → fleet dashboard with three robots → open `turtlebot3_02` → take
control → drive it with `W` (telemetry shows `0.20 m/s`) → `turtlebot3_03` →
system health.*

Walking through it yourself:

1. **Sign in** at the console with the operator credentials above.
2. **Fleet dashboard.** Every robot known to the registry, with status and
   battery. Robots self-register the first time they publish telemetry — the
   list is not a fixed roster.
3. **Open a robot.** Live telemetry, a 360-point LIDAR plot, onboard health
   (CPU / memory / temperature / broker), the camera panel, and teleop.
4. **Take control**, then drive with `W` `A` `S` `D` or the arrow keys while
   the page has focus. Control is exclusive: one operator per robot, and the
   header shows who holds it.
5. **Emergency stop** is on every robot page and latches until released.

### Running three robots

`make up` starts one robot. To demonstrate the fleet:

```bash
make up-fleet     # adds turtlebot3_02 and turtlebot3_03
make fleet-logs   # tail just the two extra robots
make fleet-down   # remove them again, main stack keeps running
```

The two extra robots run the same `robot_agent` package with the mock ROS
adapter, so they publish the same topics and register the same way — but
without ROS 2, Gazebo or GStreamer:

| | `turtlebot3_01` | `turtlebot3_02` / `_03` |
|---|---|---|
| Image | 5.41 GB | 212 MB |
| RAM in use | ~395 MiB | ~15 MiB |
| Telemetry, LIDAR, teleop, e-stop | yes | yes |
| Camera / WebRTC video | yes | **no** |

A simulated robot has no camera, and none is faked. Its camera panel shows
`Connecting to camera` and then settles on **`Camera unavailable`** after the
20-second relay timeout. That is the intended behaviour, not a fault.

### Video

Plain `make up` is headless with no camera feed. Pick one:

```bash
make up-test-pattern   # synthetic pattern, no hardware needed
make up-camera         # real webcam (set CAMERA_DEVICE in .env)
make up-gui            # also opens Gazebo's own window (grants X11 — see F5)
```

### Everyday commands

```bash
make ps        # container status
make health    # curl backend + robot + frontend health endpoints
make logs      # tail everything, or: make logs SERVICE=robot
make token     # print a fresh operator JWT, for curl
make down      # stop, keeping Postgres/Redis/Mosquitto data
make clean     # stop AND delete all data volumes
```

Calling the API directly:

```bash
TOKEN=$(make -s token)
curl -s localhost:8000/robots -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### If it will not start

| Symptom | Cause and fix |
|---|---|
| `failed to bind host port …: address already in use` | Another process or project holds that port. See [Port overrides](#port-overrides). |
| `NetworkError when attempting to fetch resource` at sign-in | `CORS_ALLOWED_ORIGINS` does not match the origin serving the console. Both must move together when you change `FRONTEND_PORT`. |
| Console loads, every request fails | `API_BASE_URL` points at a port the backend is not on. It is the address the **browser** uses, not an internal service name. |
| Robot container unhealthy, high CPU | Gazebo still loading. First start can take a minute or more. |
| Whole machine freezes on `make up` | Not enough RAM for Gazebo. Lower the `robot` service's memory limit in `docker-compose.yml`, or use `make up-fleet`'s lighter robots. |

---

## 2. ROBOSTORE

The demo app-store console: four robot-control apps, a sensor reference, four
project write-ups, and an AI section. It is a proof of concept — the login is
a stub and no page talks to a robot.

### Option A — no Docker

Needs Node.js 18+ and nothing else.

```bash
cd robostore-poc
npm install
npm run dev        # http://localhost:3100
```

Stop with `Ctrl+C`. There is nothing else to tear down, and no backend to
start — the login is client-side and none of the apps calls a server.

### Option B — Docker

```bash
cd cloud-robotics

make robostore-up        # build + start, waits until it responds
make robostore-open      # open it in your browser
make robostore-logs      # tail its logs
make robostore-down      # stop it
```

This uses `docker-compose.robostore.yml`, which pins its own Compose project
name. It never mixes into `make ps` for the main stack, and the two run side by
side without interfering.

There is also a production target, serving the compiled bundle through nginx on
a separate port:

```bash
make robostore-up-prod   # http://localhost:3101
```

### Credentials

**Any email address, and any password of 6 or more digits.** The documented
pair, and the one `make robostore-up` prints, is:

```
operator@robot.local  /  123456
```

This is a stub gate, not authentication — `robostore-poc/src/hooks/useAuth.ts`
accepts every attempt after a short fake delay and stores the session in
`localStorage`. It exists so the UI has a real sign-in flow to build against.
Do not read it as a security control.

### What you should see

![ROBOSTORE walkthrough](docs/images/robostore-walkthrough.gif)

*Sign in → Robot control → Robot sensors → RPLIDAR reference → Robotics
projects → AI & robotics → a distribution page → then the Light, Blue and Dark
themes.*

The rail has four sections:

| Section | Contents |
|---|---|
| **Control** | Dashboard · Remote control · Route planner · Emergency stop |
| **Sensors** | Orbbec Astra · RPLIDAR A1 · 9-DOF IMU · Ultrasonic array |
| **Projects** | Line follower · Object tracker · Human follower · Patrol loop |
| **AI** | *Statistical distributions* (Uniform, Exponential, Normal) and *AI driven robot* (ROS 2 MCP design, Prompting robotics) |

### Themes

Four options in the top bar: **Light**, **Dark**, **Blue**, **Auto**. Auto
follows your operating system and keeps following it. The choice persists in
`localStorage` and is applied before first paint, so there is no flash on
reload. Below 640 px the segmented control collapses into a menu.

### Ports

| What | Port | Variable |
|---|---|---|
| Dev server | 3100 | `ROBOSTORE_PORT` |
| Production build | 3101 | `ROBOSTORE_PROD_PORT` |

Moving ROBOSTORE's port is a one-value change — unlike the Cloud Robotics
console, there is no API base URL or CORS origin to keep in step, because
nothing it renders calls a backend.

---

## Port overrides

Every host port in both stacks is an environment variable with a default, so
nothing in the repository needs editing when one is taken. `.env` is gitignored,
so an override stays local to your machine.

| | Cloud Robotics | ROBOSTORE |
|---|---|---|
| Console | 3000 `FRONTEND_PORT` | 3100 `ROBOSTORE_PORT` |
| Backend API | 8000 `BACKEND_PORT` | — |
| Robot health | 8080 `ROBOT_HEALTH_PORT` | — |
| MQTT | 1883 `MQTT_HOST_PORT` | — |
| MQTT over TLS | 8883 `MQTT_TLS_HOST_PORT` | — |
| PostgreSQL | 5432 `POSTGRES_PORT` | — |
| Redis | 6379 `REDIS_PORT` | — |

`coturn` is the exception: it runs with `network_mode: host`, so it binds
`TURN_PORT` (3478) and the relay range 49160–49200 directly.

**Moving the Cloud Robotics console or API means moving four values, not one.**
The browser is told where the API lives, and the API is told which origin may
call it:

```bash
FRONTEND_PORT=3300                            # where the console is served
BACKEND_PORT=8200                             # where the API is served
API_BASE_URL=http://localhost:8200            # what the BROWSER is told to call
CORS_ALLOWED_ORIGINS=http://localhost:3300    # which origin the API will answer
```

Miss `API_BASE_URL` and the console loads but every request goes to a dead
port. Miss `CORS_ALLOWED_ORIGINS` and the browser blocks the request before it
is sent — which Firefox reports as `NetworkError when attempting to fetch
resource` and Chrome as a CORS error, neither of which sounds like a port
problem. The server is healthy the whole time; only the allowlist is wrong.

---

## Running both at once

They use different ports and different Compose projects, so:

```bash
make up-fleet        # Cloud Robotics, 3 robots
make robostore-up    # ROBOSTORE alongside it
docker ps            # 9 + 1 containers
```

`make down` stops only the main stack; `make robostore-down` stops only
ROBOSTORE.

---

## How the GIFs were made

Both recordings are Playwright driving a real Chromium against the running
stacks — not mockups. The script signs in, navigates, and in the Cloud Robotics
case takes control of a robot and actually drives it, which is why the telemetry
in that frame reads `0.20 m/s`.

```bash
pip install playwright && playwright install chromium
python3 capture.py          # screenshots each step
                            # then assembled to GIF with Pillow
```

To re-record after a UI change, run the capture against a live stack and
re-encode. Frames are held ~1.7 s each so a reader can follow without pausing.

---

## See also

- [`README.md`](README.md) — architecture, the build roadmap, and the reasoning
  behind each milestone
- [`docs/`](docs/) — one document per milestone, plus
  [`security-findings.md`](docs/security-findings.md) and
  [`target-architecture.md`](docs/target-architecture.md)
- [`secure_robotstore/`](secure_robotstore/) — a deliberately insecure training
  copy of this stack, with its own run instructions and a twelve-exercise
  security programme. Unrelated to the two applications above.
