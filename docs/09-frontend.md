# 09 — The Frontend

> **Status: complete.** The React + TypeScript + Tailwind operator console is real, not a stub: login, a live fleet dashboard, a Robot page with actual decoding WebRTC video and arrow-button/keyboard teleop throttled to 20Hz, an emergency stop, Health and Settings pages. Verified end-to-end with a real, **unmodified** Chrome browser driven by Playwright - and getting there surfaced two genuine WebRTC integration bugs neither Milestone 6 nor Milestone 8 could have found, because neither ever exercised a second real browser connection. Both are fixed at the root, not worked around. See Verification below for the full story.

## What this step is

The last piece of the diagram both `00-overview.md` and every milestone since have been building toward:

```
Browser → React → FastAPI → MQTT → Robot Cloud Agent → ROS2 → Turtlebot3   (command path)
Camera → ROS2 → GStreamer → WebRTC → Browser                                (video path)
```

Milestones 1-8 built a robot that can be commanded and watched, and a backend that knows how to talk to it - all proven with `curl`, WebSocket clients, and hand-written Playwright pages standing in for a real frontend. This milestone builds the actual frontend those stand-ins were rehearsing for: a `cloud-container/frontend/src/api/client.ts` that calls the exact endpoints `docs/07-cloud-backend.md` and `docs/08-webrtc-signalling.md` documented, and pages that exercise them the way an operator actually would - not synthetic test traffic, but a person clicking a robot card, watching it think, and driving it with a keyboard.

## Why it's needed

### Why build an API client + typed models by hand instead of generating them from OpenAPI?

FastAPI serves a complete OpenAPI schema for free at `/openapi.json`, and codegen from it is a legitimate choice for a larger API. This one is five response shapes (`RobotSummary`, `RobotDetail`, `SessionInfo`, `TokenResponse`, the WebRTC offer/answer pair) that change rarely - a generation step would be more build machinery than the surface it's generating actually needs. `src/api/types.ts` says as much in its own header comment, including the actual threshold ("if the API surface grows a lot...") at which the tradeoff would flip.

### Why does watching video not require holding the control session, but driving does?

This was decided architecturally back in `docs/00-overview.md` (Path 1 vs Path 2 are independent) and enforced server-side in `docs/08-webrtc-signalling.md` (`POST /robots/{id}/webrtc/offer` requires auth, not a session). The frontend just has to *respect* that boundary rather than accidentally coupling the two - which is why the Robot page's `useWebRTCVideo` hook is `enabled` unconditionally once the page mounts, while `useTeleopSocket` only connects once the operator explicitly clicks **Take control**. Getting this backwards (auto-acquiring control just to show video) would silently take the lock away from whoever's actually supposed to have it.

### Why one shared `useThrottledTeleop` hook behind both the arrow buttons and the keyboard, instead of two separate throttles?

The frontend README's requirement is "arrow-button + keyboard teleop (throttled to 20Hz)" - two *inputs*, one *rate limit*. Implementing the throttle twice would risk them drifting (or, worse, stacking: a held key and a held button at once sending 40 commands/sec instead of 20). `useThrottledTeleop` owns the `setInterval`/`start`/`stop` state once; `useKeyboardTeleop` and `TeleopPad`'s pointer handlers are both just callers.

### Why does `useTeleopSocket` refuse to auto-reconnect, when `useStatusSocket` does?

`useStatusSocket` backs the Dashboard's fleet overview - a stale-by-a-few-seconds view during a reconnect is a minor UX blemish. `useTeleopSocket` backs an *exclusive control session* (`docs/07-cloud-backend.md`'s `SessionManager`): silently reopening it after a drop would mean the operator's session got re-acquired behind their back, possibly stealing it back from whoever legitimately took over in the gap. Losing the socket surfaces as `state: 'closed'`/`'error'` in the UI and hands control back to an explicit **Take control** button instead.

### Why does the JWT live in `localStorage`, decoded client-side for expiry, when the backend is the real source of truth?

`AuthContext`'s expiry check is explicitly documented (in its own file header) as a UX nicety, not a security boundary - it just shows the login page proactively instead of waiting for an inevitable 401. A tampered value there can only make the app *think* it's logged in longer than it is; every real request still gets independently verified by `app/auth/dependencies.py` server-side, same as always.

## What it does

**API layer:**
- `src/api/types.ts` - hand-written TS mirrors of `backend/app/models.py`'s response shapes, plus the raw MQTT-payload-shaped `RobotTelemetry`/`RobotHealth` (`registry/store.py` passes those through unmodified, so the frontend types mirror the robot side, not the backend's `dict`-typed field).
- `src/api/client.ts` - a typed `fetch` wrapper. Every function resolves its base URL through `getRuntimeConfig()` (`src/config.ts`, unchanged from Milestone 2) rather than a build-time constant - the same built JS bundle still works against any backend address, no rebuild, exactly as `docs/02-docker-foundations.md` originally promised.

**Auth:**
- `src/auth/AuthContext.tsx` - login/logout, JWT + operator name persisted to `localStorage`, passive expiry timer.
- `src/auth/ProtectedRoute.tsx` - route guard wrapping every authenticated page, redirects to `/login` and remembers where the operator was headed.

**Hooks** (`src/hooks/`):
- `useStatusSocket` - `/ws/status`, auto-reconnecting, backs the Dashboard.
- `useTeleopSocket` - `/ws/teleop/{robot_id}`, connects only while `enabled`, does **not** auto-reconnect (see above).
- `useThrottledTeleop` - the shared 20Hz start/stop throttle behind both input methods.
- `useKeyboardTeleop` - arrow keys/WASD → the same throttle, ignoring keystrokes aimed at form fields.
- `useWebRTCVideo` - the offer/answer flow, now reading `iceServers` from runtime config (see Verification - this is one of the two real fixes this milestone required).

**Pages** (`src/pages/`) + `src/components/Layout.tsx`, `TeleopPad.tsx`, `StatusDot.tsx`:
- `Login` - real credential check against `/auth/login`, redirects back to the originally-requested page on success.
- `Dashboard` - live fleet overview via `useStatusSocket`.
- `Robot` - live WebRTC video, the arrow-pad + keyboard teleop, take/release control, emergency stop (bypasses the session, same as the backend's own override), polled telemetry/health panels.
- `Settings` - real session identity (operator, token expiry countdown) and runtime config (API base URL) - deliberately not a form that saves nothing, since there's no per-operator preference store to save it to yet.
- `Health` - the backend's own `/health` and `/metrics`, the spiritual successor to Milestone 2's original connectivity-check stub.

**Routing:** `src/App.tsx` wires all of the above through `react-router-dom` (new dependency).

## Verification

Verification here meant something more specific than "the pages render": this milestone was told to reuse "the exact offer/answer flow this milestone's own verification exercised by hand" from Milestone 8 - so the bar was a **real, unmodified Chrome browser** completing the whole flow through the real frontend, not a hand-crafted test page. Getting there took two real debugging passes.

### First pass: video got stuck at "negotiating" forever, on the very first real connection

A Playwright-driven Chrome loaded the actual app, logged in, opened the Robot page, and waited. `pc.connectionState` never left `negotiating`; the `<video>` element's `readyState` stayed `0` (`HAVE_NOTHING`) indefinitely, even though `ontrack` had already fired and a `MediaStream` was assigned to `srcObject`. That's the tell: `ontrack` firing only means the SDP answer was applied, not that media is flowing - readyState staying at 0 meant ICE never actually connected.

Capturing the real offer/answer SDP (via Playwright's own request/response interception, not a proxy) showed why: Chrome's offer advertised **only** `mDNS`-obfuscated host candidates (`a=candidate:... ea978795-....local ... typ host`) - a privacy feature Chrome has enabled by default for years, hiding a browser's real local IP behind a random `.local` hostname in the SDP it hands to the remote peer. The robot's GStreamer/libnice ICE stack has no way to resolve those (no mDNS resolver in a minimal container, and Docker bridge networks don't relay multicast to the host by default) - so it had no usable address to even attempt connecting back to. Raw UDP reachability between host and container was independently confirmed working (`nc`-style socket test, both directions) - this was never a networking/firewall problem, it was specifically about candidate *visibility*.

**The fix:** wire a local TURN relay ([coturn](https://github.com/coturn/coturn)) into `docker-compose.yml` and configure it as an `iceServers` entry on the browser's `RTCPeerConnection` (`useWebRTCVideo.ts`, credentials from runtime config - the same "one shared dev credential from env" shape as MQTT/operator auth). A TURN *relay* candidate is never mDNS-obfuscated (it's the TURN server's own address, not the browser's local network info), so it gives the robot a real, resolvable address regardless of what Chrome does with its own local candidates. Confirmed with completely unmodified Chrome (no `--disable-features` flags, which was tried first purely as a diagnostic and is **not** the shipped fix - real operators can't be told to change browser flags): `connectionState` reaches `connected` in ~1-2 seconds, `videoWidth: 640`, `readyState: 4`, `currentTime` advancing continuously.

This isn't a dev-only workaround bolted on to pass a test, either: a real robot behind a NAT/firewall in an actual AWS deployment needs a TURN relay for exactly the same reason a browser on someone else's network would fail to reach it directly. Local coturn today, a managed/self-hosted TURN service in AWS later - no architectural change, same as everything else in this project's migration story.

### Second pass: the *second* connection (a page reload) went silent

With TURN wired in, a single connection worked - but reloading the page (or navigating away from the Robot page and back, both completely ordinary things a real frontend does) produced a second `RTCPeerConnection` and a second SDP offer, and *that* connection got stuck exactly the same way the first one originally had, while robot metrics showed `rtp_packets_sent` frozen (not climbing) even though a first connection had briefly been sending. Milestone 6/8's own verification never exercised this because both used exactly one offer per process lifetime by construction - a real frontend used by a real person cannot make that assumption.

The root cause was in `video_streamer.py`, not the frontend: `VideoStreamer` built exactly **one** `webrtcbin` element for the whole process and, after the first offer linked it into the pipeline, handled any later offer by mutating that same element's properties in place (`_ensure_webrtcbin_linked`'s own docstring called this "not this project's primary scenario yet" and "best-effort" - an honest flag from Milestone 6 that turned out to matter). GStreamer's `webrtcbin` models exactly one peer connection internally; calling `set-remote-description` again with a brand-new offer (fresh ICE credentials, from an unrelated `RTCPeerConnection`) doesn't open a second connection - it corrupts the first one's ICE agent state instead, which is exactly the "first connection goes silent, second connection never progresses" symptom observed.

**The fix:** `_prepare_fresh_webrtcbin()` replaces `_ensure_webrtcbin_linked()` - every offer now tears down whatever `webrtcbin` answered the previous one (if any) and links a brand-new one, unifying what used to be two separate "first offer" / "later offer" code paths into one. This still only supports one connected viewer *at a time* (multi-viewer fan-out remains a documented non-goal, not a silent limitation), but a viewer can now reconnect - reload, navigate away and back, whatever a real session does - as many times as they want. Verified explicitly: three sequential connections (initial load, full page reload, navigate-away-and-back) each independently reached `connected` with real decoding video; the robot's `/metrics` showed 4-5 offers handled, 0 failed, and `rtp_packets_sent` climbing continuously across all of them.

### Full end-to-end pass (after both fixes)

A single Playwright script, real Chrome, no special flags, driving the actual running app against the actual running stack:

- Unauthenticated `/` redirects to `/login`; wrong credentials show an error and don't navigate.
- Correct credentials log in, JWT persists to `localStorage`, land on `/dashboard`.
- The real robot appears via the live `/ws/status` feed.
- Clicking into it reaches the Robot page; WebRTC reaches `connected` with real dimensions (`640×480`), `readyState: 4`, `currentTime` advancing - confirmed against the robot's own `/metrics` (`webrtc_offers_handled` incrementing).
- **Take control** acquires the real teleop session; holding the on-screen **forward** arrow button sends multiple throttled commands (`commands_received` rising by more than one per hold, proving repeat-while-held, not a single click); holding an arrow **key** does the same.
- **Emergency Stop** reaches the robot without holding control.
- Telemetry/health panels show real polled values; **Release control**, Health page, Settings page (real operator name, real API base URL) all check out.
- **Logout** clears the token and redirects; a protected route visited afterward bounces straight back to `/login`.

24/24 substantive checks passed. One assertion ("zero console errors") was initially treated as a 25th check and flagged 2-3 "Failed to load resource" messages - traced to React 18 `StrictMode`'s intentional dev-mode double-invocation of effects (mount → cleanup → mount again, to catch cleanup bugs), which briefly opens and immediately aborts a `WebSocket`/`RTCPeerConnection` on first mount. Confirmed benign (StrictMode's double-invoke never happens in a production build) and, if anything, positive evidence the hooks' cleanup functions work correctly - a real leak would show as duplicate live connections, not a console message. Not a product defect; noted here rather than silently dropping the check.

All existing suites re-verified after both fixes: **44/44 backend tests**, **27/27 non-async robot tests** (5 pre-existing async tests remain skipped in the container's minimal `pytest` install - an environment gap predating this milestone, unrelated to the changes here) pass against the live stack.

## Running it yourself

```bash
cp .env.example .env   # picks up TURN_USERNAME/TURN_PASSWORD/etc. defaults
docker compose up -d --build
docker compose ps      # coturn, mosquitto, redis, postgres, backend, frontend, robot - all healthy/running

open http://localhost:3000
# login: operator / operator_dev_password (from .env.example)
```

To see real video without a physical webcam, opt into the synthetic test pattern for this run only (same "off by default, explicit opt-in" contract `CAMERA_TEST_PATTERN_FALLBACK` has had since Milestone 6):

```bash
CAMERA_TEST_PATTERN_FALLBACK=true docker compose up -d --no-deps robot
```

Run the frontend's own build/typecheck:

```bash
cd cloud-container/frontend
npm install
npx tsc --noEmit
npm run build
```

Run the full test suite against the live stack:

```bash
pip install -r cloud-container/tests/requirements.txt
pytest cloud-container/tests/ -v            # 44 tests

docker cp robot-container/tests cloud-robotics-robot:/robot/tests
docker compose exec robot python3 -m pytest /robot/tests -v   # 27 non-async tests
```

## Next steps

- **Milestone 10**: full end-to-end integration + expanded test suite - a natural next step given this milestone's own verification was already a real, scripted, real-browser end-to-end run; formalizing it (and the coturn-backed WebRTC path) into the permanent suite is the obvious continuation rather than new territory.
- Noted, not blocking: multi-viewer fan-out (more than one browser watching the same robot's video at once) remains a documented non-goal - `_prepare_fresh_webrtcbin()` now correctly supports *sequential* single-viewer reconnects, not concurrent multiple viewers. Revisit only if the platform actually needs simultaneous observers, which the spec doesn't currently ask for.
- Noted, not blocking: coturn's TURN credentials are a single shared dev pair from `.env`, matching every other credential in this project's local-simulation scope (MQTT, operator login) - real per-operator/time-limited TURN credentials (coturn supports this natively) are a natural follow-up alongside the real multi-operator accounts noted in `docs/07-cloud-backend.md`, not a redesign.

Next: [10 — Testing Strategy](10-testing-strategy.md) (Milestone 10) - complete.
