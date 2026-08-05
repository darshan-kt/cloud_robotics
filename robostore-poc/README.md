# ROBOSTORE — demo app-store console (POC)

A second, independent frontend living in this repo alongside the real
operator console (`cloud-container/frontend`). Where that console is the
single, tested, AWS-migration-scoped teleop UI, this is a sandbox for
showcasing new operator-app ideas — a "mission deck" login and hub leading to
a grid of small robot apps, built and proposed one at a time.

**Login:** `operator@robot.local` / `123456` (any email + a 6-digit-or-longer
password also works — see "Two data layers" below for why).

## Why this is a separate app, not new routes in `cloud-container/frontend`

Three concrete reasons, not just taste:

1. **Version conflict.** This app targets React 19 + `react-router-dom` v7.
   `cloud-container/frontend` is pinned to React 18.3 + v6.26. Adding these
   routes there would force an upgrade across the whole tested operator
   console just to host a demo.
2. **Different design system.** The "mission control" dark/mono/animated
   aesthetic here is deliberately distinct from the operator console's own
   look — mixing them in one `index.css`/`tailwind.config` would fight itself.
3. **Blast radius.** Nothing in here can break the operator console. Deleting
   this folder deletes the whole experiment and touches nothing else.

It's still in the *same repo* (not a separate git project) on purpose — the
plan is for these apps to eventually read real lidar/camera/command data from
`robot-agent` via the existing backend, and that's much easier to keep in
sync with `docs/api-reference.md` and `docs/configuration-reference.md` when
it's one `git log` away, not a second repo to keep in sync by hand.

## Two data layers — read this before adding a new app

Same split as the rest of this project ([`docs/00-overview.md`](../docs/00-overview.md)),
applied to this app:

1. **App data** (robot profile, sensors, missions, maps, safety zones,
   schedules, conversations) — has **no backend**. It lives in the browser
   via IndexedDB, behind the repository module `src/lib/localDb.ts`. Every
   page imports `localDb`, never `src/lib/idb.ts` directly — that's the
   migration seam. To point this at a real backend later: keep every
   exported function's name and signature identical, replace each body's
   `idb` call with a `fetch()` call. No caller needs to change.
2. **Live robot data** (position, LIDAR, localisation, path plan, teleop) —
   the build brief this app was built from specifies a bespoke REST + 5×
   WebSocket "gateway" (`src/lib/config.ts`'s `GATEWAY_URL`, default
   `http://localhost:1717`). **That gateway doesn't exist in this system.**
   When an app that needs live data gets built, prefer wiring its hooks to
   the *existing* `cloud-container` FastAPI backend instead of standing up a
   second bespoke backend — it already exposes robot telemetry, lidar
   (`RobotDetail.lidar`) and teleop (`/ws/teleop`,
   `/robots/{id}/webrtc/offer`). Same contract shape, real transport.

Auth (`src/hooks/useAuth.ts`) is a stub on purpose — any email + 6-digit
password signs in, session persisted to `localStorage`. This gates the hub
behind a real login screen without pretending there's a real backend behind
it yet.

## Status

**All four apps are built and real**, verified against the actual dev server
in a real browser (not just typechecked):

| App card | Route | Status |
|---|---|---|
| Dashboard | `/dashboard` | Real — 4 tabs (Robot Info, Sensors, Configuration, System), live status strip, heartbeat sparkline, inline-editable config with validation |
| Emergency Stop | `/emergency-stop` | Real — big E-Stop button, spacebar shortcut, reverse-chronological history log, optimistic UI |
| Remote Controller | `/remote-controller` | Real — LIDAR HUD canvas, virtual joystick (8-sector angle bucketing), WASD keypad, 10Hz teleop transmit loop, lift simulation |
| Simple Route Planner | `/simple-route-planner` | Real — three-source map loading (`/map.pgm` → localDb → upload), two-click waypoint placement, layered canvas render (map/plan/waypoints/robot/AMCL), route dispatch with 3-way error handling |

`ComingSoonPage.tsx` is kept in the tree, unused, as the placeholder for
whatever gets proposed as app #5.

**Live data is genuinely absent, and that's expected, not broken**: every
hook that talks to `GATEWAY_URL` (`ws://localhost:1717/...`) fails to connect
and retries with backoff forever, exactly as designed - the console errors
you'll see in devtools are that, not a bug. Pages render correctly with no
data: "OFFLINE"/"Not Connected" pills, "WAITING FOR /scan…" HUD text, "no
AMCL fix yet". See "Two data layers" above for the Phase 2 plan.

**Decisions made where the build brief was ambiguous or described a
questionable behavior**, documented in code comments at the point of
decision, listed here too so they're not buried:

- **E-Stop button labels** (`EmergencyStopPage.tsx`) — the brief's
  "armed → STOP ENGAGED" / "active → STOP RELEASED" pairing reads backwards
  from how a physical E-stop's latch is normally named. Labeled by current
  state instead: "SYSTEM ARMED" (idle) / "E-STOP ACTIVE" (triggered) - never
  ambiguous about what the button will do.
- **Remote Controller's "EMERGENCY STOP" button** (`RemoteControllerPage.tsx`)
  — the brief describes it as cosmetic (zeroes velocity, shows a toast, never
  touches the real E-Stop registry). Built as a real safety footgun if copied
  as-is: a button labeled EMERGENCY STOP that the header badge, the Emergency
  Stop page's history, and the Route Planner's dispatch guard would all stay
  blind to. Wired it to the same `localDb.triggerEmergencyStop()` the
  dedicated page uses - it only ever triggers, never releases, matching that
  page's "release is always a deliberate click" rule.
- **Distance-remaining readout** (`SimpleRoutePlannerPage.tsx`) — the live
  robot marker's position (`telemetry.x/y`) is documented to already be in
  canvas-pixel space, not meters, so it can't be subtracted from the Nav2
  plan's real map-frame-meter goal to produce a physically meaningful number.
  Used the AMCL pose (`localisation`, real meters, same frame as the plan)
  instead; shows "—" with no AMCL fix yet rather than a fabricated distance.

## Running it

## Running it

Two ways — full step-by-step for both is in the root
[`README.md`](../README.md#running-robostore), this is the short version.

**npm, on the host** (instant hot-reload while editing):

```bash
cd robostore-poc
npm install
npm run dev              # http://localhost:3100
```

```bash
npm run build             # tsc --noEmit && vite build -> dist/
npm run preview            # serve the production build locally
```

**Docker, via the root Makefile** (own Compose file, own Compose project
`robostore-poc` — never mixed into the main stack's `docker compose`/`make`
commands):

```bash
make robostore-up          # dev target, http://localhost:3100 - from repo root
make robostore-up-prod       # nginx-served build, http://localhost:3101
make robostore-down            # stop it
```

See [`docker-compose.robostore.yml`](../docker-compose.robostore.yml) and
[`docker/robostore.Dockerfile`](docker/robostore.Dockerfile) — same dev/prod
two-target shape as `cloud-container/docker/frontend.Dockerfile`. No bind
mount for the dev target (matches that file too), so under Docker an edit
needs `make robostore-up` run again to rebuild; under npm on the host it's
instant Vite HMR.

`cloud-container/frontend` (the real console) still runs on 3000 — all of
the above can run side by side with it.

Set `VITE_GATEWAY_URL` (see `.env.example` at the repo root) once an app
actually needs live data; until then it's unused.

## Project structure

```
src/
  components/
    layout/     Header, ProtectedRoute
    ui/         Card, Badge, Button, Skeleton, EmptyState, Toast
  hooks/        useAuth (stub session)
                useReconnectingSocket (shared reconnect-with-backoff shell)
                useTelemetry, useLocalisation, usePlan, useScan, useVelocityCtrl
  lib/          config, idb, localDb, pgmParser, utils
  pages/        LoginPage, AppStorePage, ComingSoonPage (unused placeholder)
                DashboardPage, EmergencyStopPage, RemoteControllerPage,
                SimpleRoutePlannerPage
  types/        data model interfaces
  App.tsx       routes
  main.tsx      entry
  index.css     design tokens, aurora background, hub animations
```

Note on `RemoteControllerPage.tsx`: per the build brief, it does NOT use the
shared `useTelemetry` hook - it hand-rolls its own inline `/api/telemetry`
connection with a flat 3s reconnect (no backoff) and a custom text-frame
`ping`/`pong` latency probe layered on the same socket, both deliberate
deviations documented in a comment at the top of that file. Every other
WebSocket-driven page uses the shared hooks normally.

## Design tokens

Dark-only. Palette, fonts, and the full animation system (aurora background,
`animate-pulse-status`, `animate-fade-up`/`.stagger-N`, the hub-only tilt/
spotlight/beam/ticker effects) are defined in `tailwind.config.ts` and
`src/index.css`. `prefers-reduced-motion: reduce` disables every animation
listed above — verified in both files, not just one.
