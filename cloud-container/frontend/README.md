# cloud-container/frontend/

**Purpose:** the operator console — a React + TypeScript + Tailwind single-page app.

**Contains:**
- `src/api/` — typed API client (`client.ts`) + TS mirrors of the backend's response models (`types.ts`)
- `src/auth/` — `AuthContext` (login/logout/token persistence) + `ProtectedRoute`
- `src/hooks/` — `useStatusSocket`, `useTeleopSocket`, `useWebRTCVideo`, `useThrottledTeleop`, `useKeyboardTeleop`
- `src/pages/` — **Login**, **Dashboard** (live fleet overview), **Robot** (live WebRTC camera, a LiDAR scan panel, arrow-button + keyboard teleop throttled to 20Hz, connection status, robot state, battery, velocity, emergency stop), **Settings**, **Health**
- `src/components/` — `Layout` (nav shell), `TeleopPad`, `StatusDot`, `LidarView` (canvas-drawn top-down scan plot, post-Milestone-11)

**Filled in:** Milestone 9 — see [`docs/09-frontend.md`](../../docs/09-frontend.md), including the real WebRTC/ICE debugging story (mDNS + a shared-`webrtcbin` reconnect bug, later found to only be narrowed rather than closed - see that doc's "fourth pass") that verifying this against a real browser surfaced. LiDAR panel added post-Milestone-11.
