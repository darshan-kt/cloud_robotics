# secure_robotstore

A deliberately **insecure** miniature of this repo's cloud-robotics stack,
built as a training target. Interns add the security layers back, one at a
time, and can diff their work against the real implementation living beside
it in `cloud-container/` and `robot-container/`.

It is small on purpose — one device, two data types, ~1,200 lines — but the
architecture is the real one, not a toy: same MQTT-only device boundary,
same Redis/Postgres split, same "one service owns the broker connection"
rule, same paho-thread-to-asyncio hand-off.

```
┌─────────────┐   MQTT     ┌───────────┐   MQTT    ┌─────────────────────┐
│ robot-agent │ ─────────► │ mosquitto │ ────────► │      backend        │
│  publishes  │  devices/  │  (broker) │ devices/  │  MQTTService        │
│  1 string   │  {id}/     │           │  +/       │       ↓             │
│  1 integer  │  string    │           │  string   │  ReadingStore       │
│  every 1s   │  devices/  │           │  devices/ │    ├──► Redis    (live value + ring buffer)
│             │  {id}/int  │           │  +/int    │    ├──► Postgres (durable history)
└─────────────┘            └───────────┘           │    └──► Hub      (fan-out)
                                                   └──────────┬──────────┘
                                                   /ws/string_api, /ws/int_api
                                                              ▼
                                                   ┌─────────────────────┐
                                                   │ frontend            │
                                                   │  /login             │
                                                   │  /remote-data       │
                                                   │   ├ String window   │
                                                   │   └ Integer window  │
                                                   └─────────────────────┘
```

## Run it

No Docker needed. You install five ordinary programs, then start four things in
four terminals. If you have never used a terminal much, that is fine — every
command below is meant to be copied exactly.

### Step 1 — install the pieces (once)

You need **Python 3.10+**, **Node.js 18+**, and three small background services:
an MQTT broker (mosquitto), Redis, and PostgreSQL.

**Ubuntu / Debian / WSL**

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip \
                    mosquitto mosquitto-clients \
                    redis-server postgresql
```

**Important — turn the auto-started services off.** Ubuntu starts mosquitto and
Redis immediately, on ports 1883 and 6379. Those are the ports the full
cloud-robotics platform uses, so leaving them running stops that platform from
starting at all. You also want to run these yourself, so you can read their logs
and edit their config:

```bash
sudo systemctl stop mosquitto redis-server
sudo systemctl disable mosquitto redis-server
```

Postgres is the one service worth leaving running, so move it to port 5433
instead, which frees 5432 for the main platform:

```bash
sudo sed -i 's/^port = 5432/port = 5433/' /etc/postgresql/*/main/postgresql.conf
sudo systemctl restart postgresql
pg_lsclusters          # confirm: the port column should read 5433
```

**macOS** (with [Homebrew](https://brew.sh))

```bash
brew install python node mosquitto redis postgresql@16

# Postgres on 5433, so it does not collide with the main platform
echo "port = 5433" >> $(brew --prefix)/var/postgresql@16/postgresql.conf
brew services start postgresql@16
```

Do not `brew services start` mosquitto or redis — you will start those yourself,
in their own terminals, below.

**Windows** — install [WSL2](https://learn.microsoft.com/windows/wsl/install) and
follow the Ubuntu instructions inside it. Running these four services natively on
Windows is possible but fiddly, and nothing in these exercises needs it.

Node.js comes from [nodejs.org](https://nodejs.org) if `node -v` does not already
print version 18 or higher.

### Step 2 — create the database (once)

```bash
sudo -u postgres psql -p 5433 -c "CREATE USER robotstore WITH PASSWORD 'robotstore';"
sudo -u postgres psql -p 5433 -c "CREATE DATABASE robotstore OWNER robotstore;"
```

On macOS, drop the `sudo -u postgres` part — Homebrew's Postgres runs as you:

```bash
psql -p 5433 postgres -c "CREATE USER robotstore WITH PASSWORD 'robotstore';"
psql -p 5433 postgres -c "CREATE DATABASE robotstore OWNER robotstore;"
```

You never create the tables yourself. The backend does that on first start.

### Step 3 — install the project's own dependencies (once)

```bash
cd secure_robotstore

# Python: one virtual environment for both the backend and the agent.
python3 -m venv .venv
source .venv/bin/activate
pip install -r cloud/backend/requirements.txt -r robot-agent/requirements.txt

# JavaScript: the frontend.
cd cloud/frontend && npm install && cd ../..
```

A *virtual environment* is a private folder of Python packages belonging to this
project alone, so installing something here cannot break anything else on your
machine. `source .venv/bin/activate` is what switches a terminal into it — you
will do that in two of the four terminals below, every time.

### Step 4 — start it, four terminals

Open five terminals, all in the `secure_robotstore` directory. Leave each one
running; each prints its own log, which is most of how you will debug things.

**Terminal 1 — the MQTT broker**

```bash
mosquitto -c mosquitto/mosquitto.local.conf -v
```

**Terminal 2 — Redis**

```bash
redis-server --port 6380
```

**Terminal 3 — the backend**

```bash
source .venv/bin/activate
source local.env
cd cloud/backend
uvicorn app.main:app --reload --port 8001
```

**Terminal 4 — the robot agent**

```bash
source .venv/bin/activate
source local.env
cd robot-agent
python -m agent.main
```

**Terminal 5 — the frontend**

```bash
cd cloud/frontend
VITE_API_URL=http://localhost:8001 npm run dev -- --port 3001
```

Then open **http://localhost:3001** and sign in with `operator` / `demo1234`.
Both windows should start filling at one row per second.

Postgres is already running in the background as a system service, which is why
it does not get a terminal of its own.

`source local.env` is doing something small but essential: the backend and agent
default to the hostnames `mosquitto`, `postgres` and `redis`, which only exist
inside a Docker network. That file points them at `localhost` instead.

### Where everything is

| Service      | URL / address                    | Notes                          |
|--------------|----------------------------------|--------------------------------|
| Frontend     | http://localhost:3001            | login + Remote Data            |
| Backend API  | http://localhost:8001            | `/docs` for the OpenAPI page   |
| Backend WS   | ws://localhost:8001/ws/string_api, `/ws/int_api` | |
| Agent health | http://localhost:8081            | `{"mqtt_connected": true}`     |
| MQTT broker  | localhost:1884                   | anonymous                      |
| Postgres     | localhost:5433                   | `robotstore` / `robotstore`    |
| Redis        | localhost:6380                   | no password                    |

### Useful checks

```bash
curl localhost:8001/health/detail        # every dependency, separately
curl localhost:8001/api/int/latest       # from Redis    — the live value
curl localhost:8001/api/int/history      # from Postgres — the durable rows

mosquitto_sub -h localhost -p 1884 -t 'devices/#' -v       # watch the broker
psql -h localhost -p 5433 -U robotstore -d robotstore      # password: robotstore
redis-cli -p 6380                                          # then: KEYS *
```

### If something does not work

| Symptom | What it means |
|---|---|
| `connection refused` on port 1884 | Terminal 1 is not running. |
| The **main cloud-robotics stack** fails with `failed to bind host port 127.0.0.1:1883` or `:6379` | Ubuntu's auto-started mosquitto or redis service is holding that port. `sudo systemctl stop mosquitto redis-server` and `sudo systemctl disable mosquitto redis-server`. This sandbox never uses 1883 or 6379. |
| Backend log repeats `lost the broker connection (rc=7)` | Two MQTT clients are using the same client id and kicking each other off. You are running this twice — check for an old terminal, or a Docker copy of the stack still up. |
| `password authentication failed for user "robotstore"` | Step 2 did not run, or ran against a different Postgres. Re-run it. |
| `Peer authentication failed` | You connected over the local socket instead of TCP. Include `-h localhost` in the `psql` command. |
| Backend exits with `could not reach postgres` | Postgres is not running, or is still on 5432. `pg_lsclusters` should show port 5433. |
| Frontend loads but both windows stay empty | A terminal is not running. `curl localhost:8001/health/detail` names the broken dependency. |
| `ModuleNotFoundError: fastapi` | The terminal is not in the virtual environment. Run `source .venv/bin/activate` first. |

### Why these port numbers

Every port this sandbox uses sits **one above** the full cloud-robotics
platform's, so the two can run at the same time on one machine:

| | Main platform | This sandbox |
|---|---|---|
| MQTT broker | 1883 | **1884** |
| Redis | 6379 | **6380** |
| PostgreSQL | 5432 | **5433** |
| Backend API | 8000 | **8001** |
| Frontend | 3000 | **3001** |
| Device health | 8080 | **8081** |

Nothing you install for this sandbox should ever listen on the left-hand column.
If the main platform suddenly refuses to start, that is almost always what has
happened — see the second row of the table above.

### Running it with Docker instead

If you already know Docker, the whole sandbox also comes up with one command,
on exactly the same ports:

```bash
cp .env.example .env
docker compose up -d --build
```

Every command in the exercises works unchanged against it, except that you reach
Postgres and Redis with `docker exec sr-postgres …` / `docker exec sr-redis …`
rather than directly. Do not run the Docker sandbox and the local one at the same
time — they want the same ports, and you get the `rc=7` symptom above.

## What each piece does

### `robot-agent/` — the device

| File | Role |
|---|---|
| `agent/main.py` | Wires everything together; handles SIGTERM cleanly. |
| `agent/publisher.py` | Produces one string + one integer **every second** and publishes each to its own topic. Drift-corrected so it stays at 1 Hz over long runs. |
| `agent/mqtt_client.py` | paho-mqtt client. Re-subscribes on every reconnect; hands callbacks back to the event loop with `run_coroutine_threadsafe`. |
| `agent/topics.py` | The topic contract, device-side copy. |
| `agent/health_server.py` | ~30-line HTTP health endpoint, no framework. |

Every reading carries a monotonic `seq`. That is the debugging handle: a gap
in the browser's sequence proves messages were dropped between the device
and the screen, which is otherwise indistinguishable from a slow device.

### `cloud/backend/` — the cloud

| File | Role |
|---|---|
| `app/main.py` | App factory. Everything long-lived is built in `lifespan()` and hung on `app.state`. |
| `app/mqtt/service.py` | **The only module that touches the broker.** Subscribes fleet-wide with `+`. |
| `app/store.py` | `ReadingStore` (MQTT message → Redis + Postgres + Hub) and `Hub` (WebSocket fan-out with bounded per-client queues). |
| `app/db/redis.py` | Latest value + a capped ring buffer for backfilling new clients. |
| `app/db/postgres.py` | Durable history, two tables, parameterised queries. |
| `app/ws/stream.py` | `/ws/string_api` and `/ws/int_api`. Backfill on connect, then live pushes. |
| `app/api/auth.py` | Login. Every line of it is an exercise — see below. |
| `app/api/data.py` | REST reads over both stores. |

**Why two stores.** Postgres is the system of record — losing a row would be
a bug. Redis holds what is live and re-derivable: the latest value (a new one
is one second away) and a 50-item ring buffer used to populate a browser that
just connected. The test to apply to any new piece of data: *would losing this
on restart be a bug?* Yes → Postgres. No → Redis.

### `cloud/frontend/` — the operator UI

| File | Role |
|---|---|
| `src/pages/LoginPage.tsx` | The login form. |
| `src/pages/RemoteDataPage.tsx` | Two windows, side by side: string messages and integer messages. |
| `src/hooks/useReadingSocket.ts` | One WebSocket per data kind, with capped exponential-backoff reconnect and sequence-gap detection. |
| `src/hooks/useAuth.ts` | localStorage session. |

The two windows use **two separate WebSockets** on purpose. Multiplexing both
kinds over one socket would be less code, but this way you can break one
stream and watch exactly one window go stale while the other keeps running.

## The security work — what's missing, and why it's missing

Nothing here is secure, and that is the point. Every deliberate hole is
marked in the source with a consistent tag:

```bash
grep -rn "INTERN TASK" secure_robotstore \
  --include=*.py --include=*.ts --include=*.tsx --include=*.conf --include=*.yml
```

### See the holes before fixing them

**1. Anyone can forge device data — no credentials at all.**

```bash
mosquitto_pub -h localhost -t devices/demo-device-01/int \
  -m '{"value":999,"seq":999999}'
```

That reading is now in Redis, pushed to every open browser, and permanently
in Postgres:

```bash
psql -h localhost -U robotstore -d robotstore \
  -c "SELECT * FROM int_readings WHERE seq = 999999;"
```

**2. Anyone can read all traffic.**

```bash
mosquitto_sub -h localhost -t 'devices/#' -v
```

**3. The login is theatre.** The API and WebSockets never check the token:

```bash
curl localhost:8001/api/string/history      # 200, no token
```

The route guard in `App.tsx` hides the UI; it protects nothing.

### Suggested order

Each step has a working reference implementation in the main repo.
**[docs/exercises.md](docs/exercises.md) is the detail behind this table**: for each
task, how to prove the hole before you touch it, what "fixed" means, and how to
prove it afterwards.

| # | Task | Compare against |
|---|---|---|
| 1 | **MQTT auth** — `allow_anonymous false`, a password file, per-client credentials (edit `mosquitto/mosquitto.local.conf`) | `cloud-container/mosquitto/` |
| 2 | **MQTT ACL** — device may only *write* telemetry, backend may only *write* commands | `cloud-container/mosquitto/aclfile` |
| 3 | **Real password storage** — users in Postgres, hashed, constant-time compare, one generic error message | `cloud-container/backend/app/auth/service.py` |
| 4 | **Real tokens** — signed JWT with an expiry, verified server-side | `.../app/auth/tokens.py` |
| 5 | **Protect the endpoints** — an auth dependency on every REST route *and* both WebSocket upgrades | `.../app/auth/dependencies.py` |
| 6 | **Login rate limiting** — Redis-backed attempt limiter | `.../app/auth/rate_limit.py` |
| 7 | **Input limits** — payload size caps on MQTT and on request bodies | `.../app/mqtt/service.py` |
| 8 | **CORS + security headers** — explicit origin allowlist; CSP/HSTS/nosniff/frame-deny | `.../app/security_headers.py`, `cloud-container/frontend/nginx.conf` |
| 9 | **TLS** — broker on 8883, TLS to Postgres and Redis, HTTPS at the edge | `scripts/generate-dev-certs.sh` |
| 10 | **Service hardening** — a dedicated non-root user per service, loopback-only bindings, resource limits, tight file permissions | root `docker-compose.yml` |
| 11 | **Secrets** — nothing committed; generated per environment | `scripts/generate-secrets.sh` |
| 12 | **Audit logging** — append-only, hash-chained record of every auth event | `.../app/audit/logger.py` |

After each step, re-run the three checks above: the attack that worked before
should now fail, and the app should still work.

## Known limitations (not security — design)

These are real and worth understanding before anyone builds on this:

- **The `Hub` is in-process.** Two backend replicas would each only push to
  their own WebSocket clients. The fix is Redis pub/sub between replicas.
- **No tests.** The real backend has a `tests/` suite. Adding one for the
  reading path is a good first non-security task.
- **No migrations.** `CREATE TABLE IF NOT EXISTS` only.
- **`--reload` and bind-mounted source** are on for both Python services so
  edits apply immediately. Development settings, not production ones.
- **Postgres grows forever** at ~2 rows/second (~170k/day). Retention is not
  handled.
