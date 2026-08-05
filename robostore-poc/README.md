# ROBOSTORE — demo app-store console (POC)

A second, independent frontend living in this repo alongside the real
operator console (`cloud-container/frontend`). Where that console is the
single, tested, AWS-migration-scoped teleop UI, this is a sandbox for
showcasing new operator-app ideas — a "mission deck" login and hub leading to
a grid of small robot apps, built and proposed one at a time.

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

| App card | Route | Status |
|---|---|---|
| Dashboard | `/dashboard` | Not built — `ComingSoonPage` placeholder |
| Emergency Stop | `/emergency-stop` | Not built — `ComingSoonPage` placeholder |
| Remote Controller | `/remote-controller` | Not built — `ComingSoonPage` placeholder |
| Simple Route Planner | `/simple-route-planner` | Not built — `ComingSoonPage` placeholder |

What's real and working today: the standalone login (`/login`, rate-limited
client-side: 5 failed attempts / 60s → 30s lockout), the protected `/store`
hub with all four app cards (3D tilt, spotlight, staggered fade-in, keyboard
operable), the shared UI kit (`Card`/`Badge`/`Button`/`Skeleton`/`EmptyState`/
`Toast`), and the header's E-Stop badge (event-driven via a `localdb-estop-
updated` `window` `CustomEvent`) and gateway connection pill (polls
`GATEWAY_URL/health` every 5s — shows "Not Connected" until an app wires up a
real gateway, which is correct today).

Each app in the table above gets built out — swap its `ComingSoonPage` route
in [`src/App.tsx`](src/App.tsx) for the real page — as it's proposed.

## Running it

Standalone dev server, not part of `docker compose` yet:

```bash
cd robostore-poc
npm install
npm run dev              # http://localhost:3100
```

`cloud-container/frontend` (the real console) still runs on 3000 — both can
run side by side.

```bash
npm run build             # tsc --noEmit && vite build -> dist/
npm run preview            # serve the production build locally
```

Set `VITE_GATEWAY_URL` (see `.env.example`) once an app actually needs live
data; until then it's unused.

## Project structure

```
src/
  components/
    layout/     Header, ProtectedRoute
    ui/         Card, Badge, Button, Skeleton, EmptyState, Toast
  hooks/        useAuth (stub session)
  lib/          config, idb, localDb, utils
  pages/        LoginPage, AppStorePage, ComingSoonPage
  types/        data model interfaces
  App.tsx       routes
  main.tsx      entry
  index.css     design tokens, aurora background, hub animations
```

## Design tokens

Dark-only. Palette, fonts, and the full animation system (aurora background,
`animate-pulse-status`, `animate-fade-up`/`.stagger-N`, the hub-only tilt/
spotlight/beam/ticker effects) are defined in `tailwind.config.ts` and
`src/index.css`. `prefers-reduced-motion: reduce` disables every animation
listed above — verified in both files, not just one.
