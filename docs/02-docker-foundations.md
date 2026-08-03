# 02 — Docker Foundations

## What this step is

Milestone 2 turns the empty folder skeleton from [01 — Repository Structure](01-repository-structure.md) into six containers that actually boot together with one command: `docker compose up`. None of the real behavior exists yet — no ROS2, no fleet manager, no teleop UI — but every arrow in the [architecture diagram](00-overview.md) is now provably wired: the robot reaches the broker, the backend serves a health check, and the browser reaches the backend through it.

Think of this milestone as building the empty stage and running the wiring, before any actors (the real application logic) walk on.

## Why it's needed

### Why prove plumbing before behavior?

If Milestone 4's Robot Cloud Agent failed to reach MQTT, there'd be two possible causes: a bug in the agent's logic, or a bug in how the containers are networked. Milestone 2 eliminates the second possibility ahead of time. By the time we write real business logic, "can container A reach container B" is already a solved, tested question — every later milestone can assume the network topology works and focus purely on what runs on top of it.

### Why does every service get a healthcheck?

`docker compose up` returning immediately doesn't mean a service is *ready* — Postgres can accept a TCP connection before it's finished initializing, Mosquitto's process can be running before its listener is bound. A `healthcheck` is Docker actively confirming a service can do its job, not just that its process exists. `depends_on: condition: service_healthy` then makes those checks meaningful: the backend won't even start until Mosquitto, Redis, and Postgres report healthy, so a failure surfaces as "mosquitto never became healthy" instead of a confusing connection-refused error three layers away.

This is exactly what AWS ECS/Kubernetes readiness and liveness probes do in production — a task isn't sent traffic until its own health check passes, and it's automatically replaced if that check starts failing. Building this habit locally now means the same `HEALTHCHECK` instructions and health endpoints transfer directly to an ECS task definition later.

### Why do Redis and Postgres have no published host port?

Look at `docker compose ps` output from this milestone: `backend`, `frontend`, and `mosquitto` show a `0.0.0.0:PORT->PORT` mapping; `redis` and `postgres` don't. That's deliberate — only services that something *outside* the Docker network needs to reach (your browser, an MQTT client, `curl`) get published to the host. Redis and Postgres are only ever spoken to by the backend, over the internal `cloud-robotics-net` bridge network, by service name (`redis`, `postgres`).

This is the local stand-in for a VPC's public/private subnet split in AWS: an Application Load Balancer and public endpoints reach the backend; RDS and ElastiCache sit in private subnets that nothing outside the VPC can reach directly. Not publishing those ports locally isn't just tidiness — it's the same security boundary, shaped the same way, so there's no boundary to *add* later, only infrastructure to swap underneath it.

### Why a custom bridge network instead of the Compose default?

Compose would create an unnamed default network anyway, but naming it (`cloud-robotics-net`) makes the DNS-based service discovery explicit and intentional: every service resolves every other service by its Compose service name (`mosquitto`, `backend`, `redis`, `postgres`). That's precisely the mental model for AWS service discovery (ECS Service Connect / internal DNS) — code never hardcodes an IP, only a logical name that the platform resolves.

### Why a `dev` and a `prod` target in one frontend Dockerfile?

This was a real trade-off (see the two options you were asked to choose between). A pure production build (nginx serving compiled static files) is the most faithful mirror of what ships to AWS — but it means every single frontend code change requires a full rebuild, which would make Milestones 6–9 (where most of the frontend gets built) painfully slow to iterate on. A pure dev server is fast to iterate on but never proves the production path actually builds.

The chosen answer: one `Dockerfile`, two targets.

- **`dev`** (`node:20-alpine` + Vite's dev server) — what `docker-compose.yml` runs by default. Source is bind-mounted from the host, so edits hot-reload instantly, no rebuild.
- **`prod`** (`node:20-alpine` build stage → `nginx:alpine` serve stage) — the actual production artifact. It was built and run standalone as part of verifying this milestone (not just assumed to work), and it's what a CI pipeline or an eventual AWS deployment would build instead.

Both targets are built from the exact same source and Tailwind/TypeScript config — there's no fork to keep in sync, just a different final stage.

### Why does the frontend fetch `/config.json` instead of having its API URL baked in?

A React app built with Vite normally bakes environment variables into the JavaScript bundle *at build time* — `import.meta.env.VITE_API_BASE_URL` becomes a literal string the moment `vite build` runs. That's fine until you ask "what happens when this same built image needs to talk to a staging backend today and a production backend tomorrow?" With build-time baking, the answer is "rebuild the image" — which breaks the entire premise of this project (swap an endpoint, not the architecture).

Instead, the `prod` nginx image ships `config.template.json` (literally `{"apiBaseUrl": "${API_BASE_URL}"}`) alongside the compiled app. When the container starts, nginx's official image mechanism runs every `*.sh` script in `/docker-entrypoint.d/` before launching — this image adds `inject-runtime-config.sh`, which runs `envsubst` over that template using the container's real `API_BASE_URL` environment variable, producing `config.json`. The React app fetches `/config.json` once on load and uses whatever it finds. The exact same compiled JavaScript, unmodified, works against `localhost` or an AWS domain — the only thing that changes is one environment variable passed to `docker run` / the ECS task definition.

(In `dev` mode there's no nginx and no entrypoint script, so `/config.json` simply 404s — the frontend's `src/config.ts` catches that and falls back to `VITE_API_BASE_URL`, which Vite's dev server does pick up from the container's real environment. Same public function, `getRuntimeConfig()`, two different sources depending on target — see the file for the full explanation.)

One detail worth internalizing: `API_BASE_URL` must be an address the **browser** can reach, not one only other containers can reach. `http://backend:8000` resolves fine *inside* `cloud-robotics-net` — but your browser runs on the host, outside that network, and has no idea what `backend` means. That's why the default is `http://localhost:8000` (the host-published port), not the internal service name. This distinction — "reachable by other containers" vs. "reachable by the browser" — is exactly the distinction that matters again in AWS between an internal service endpoint and a public ALB/CloudFront URL.

### Why does the robot image already use `ros:humble-ros-base`?

Nothing in this milestone uses ROS2 — the placeholder script is plain Python talking MQTT. But the base image was still set to the real target (Ubuntu 22.04 + ROS2 Humble) now rather than starting from a generic `python:3.11-slim` and swapping later. The reasoning: Milestone 5 will need system-level ROS2 packages that only exist correctly on top of this base — starting here means Milestone 5 only ever *adds* apt packages and ROS2 workspace code, and never has to touch, retest, or risk breaking the base layer this milestone already validated boots cleanly.

### Why does the robot container publish real heartbeats before the real agent exists?

`scripts/heartbeat_placeholder.py` is explicitly not the Robot Cloud Agent — it has no dispatcher, no `ROSAdapter`, no watchdog, no WebRTC. Its only job is to load `config/default.yaml`, connect to Mosquitto with retry-until-connected logic, and publish `robots/{robot_id}/heartbeat` once a second with the same structured JSON log format every other service uses. That's enough to prove Robot → Mosquitto connectivity is real (verified during this milestone by subscribing to that exact topic from *inside* the Mosquitto container, independent of what the robot claims to have sent — see Verification below). Milestone 4 deletes this file and replaces it with the real agent built against a mock `ROSAdapter`; the MQTT connection logic it needs to get right will already be proven to work.

## What it does

Concretely, this milestone added:

- **`docker-compose.yml`** (repo root) — orchestrates `mosquitto`, `redis`, `postgres`, `backend`, `frontend`, `robot` on one bridge network, with healthchecks and `${VAR:-default}` substitution so `docker compose up` works with zero setup.
- **`.env.example`** (repo root) — every configurable value, documented, ready to copy to `.env` and override.
- **`cloud-container/mosquitto/mosquitto.conf`** — a minimal broker config (anonymous access, explicitly flagged as temporary until Milestone 3 adds auth/ACLs).
- **`cloud-container/backend/`** — a minimal FastAPI app: `app/config.py` (YAML + env-var settings loader), `app/logging_config.py` (structured JSON logging), `app/api/health.py` (`GET /health`, `GET /metrics`), `app/main.py` (app factory).
- **`cloud-container/frontend/`** — a Vite + React + TypeScript + Tailwind app with one page that live-checks the backend's `/health` and shows a connection indicator, plus the `dev`/`prod` Dockerfile and the runtime-config machinery described above.
- **`robot-container/`** — the `ros:humble-ros-base` Dockerfile, `config/default.yaml`, and `scripts/heartbeat_placeholder.py` + `entrypoint.sh`.

## Verification

This wasn't just built — it was run and independently checked:

- `docker compose config` — validated the compose file and variable interpolation
- `docker compose build` — built all three custom images (`backend`, `frontend`, `robot`) successfully
- `docker compose up -d` → `docker compose ps` — all 6 services reached `healthy` (Postgres/Redis/Mosquitto/Backend) or `running` (Frontend/Robot, which don't define a Docker-level healthcheck yet)
- `curl http://localhost:8000/health` and `/metrics` — returned the expected JSON
- `docker exec cloud-robotics-mosquitto mosquitto_sub -t 'robots/+/heartbeat'` — subscribed **from inside the broker itself**, independent of the robot's own logs, and confirmed real heartbeat messages arriving once a second
- `curl http://localhost:3000/` — confirmed the Vite dev server serves the app with HMR wired up, and `npx tsc --noEmit` passed with no type errors
- Built and ran the `prod` nginx target standalone (`docker build --target prod`, `docker run -p 3001:80 -e API_BASE_URL=...`) and confirmed `/config.json` was correctly rendered by `envsubst` and the compiled static bundle was served — proving the AWS-mirroring path isn't just theoretical

One known, accepted item: `npm audit` flags a moderate advisory in esbuild's Vite dev server (arbitrary websites could probe `localhost` dev server responses). It only affects the `dev` target's hot-reload server — not the `prod` build — and the dev server is only reachable via the Docker-published port on your own machine. Fixing it requires a Vite 6 major upgrade, which is out of scope for this milestone; worth revisiting later.

## Running it yourself

```bash
docker compose up -d      # start everything
docker compose ps         # check health status
curl http://localhost:8000/health
open http://localhost:3000     # (or just visit it in a browser)
docker compose logs -f robot   # watch heartbeats
docker compose down       # stop and remove containers (data volumes persist)
```

Next: [03 — The MQTT Layer](03-mqtt-layer.md) (Milestone 3) replaces `allow_anonymous true` with real per-robot credentials and ACLs, and formally documents the topic contract every later milestone builds on.
