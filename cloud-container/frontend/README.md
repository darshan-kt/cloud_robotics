# cloud-container/frontend/

**Purpose:** the operator console - a React + TypeScript + Tailwind single-page app.

**Contains:**
- `src/api/` - typed API client (`client.ts`) + TS mirrors of the backend's response models (`types.ts`), including runtime guards for the three payloads the backend passes through from MQTT unmodified
- `src/auth/` - `AuthContext` (login/logout/token persistence) + `ProtectedRoute`
- `src/hooks/` - `useStatusSocket`, `useTeleopSocket`, `useWebRTCVideo`, `useThrottledTeleop`, `useKeyboardTeleop`
- `src/pages/` - **Login**, **Dashboard** (live fleet overview), **Robot** (live WebRTC camera, a LiDAR scan panel, arrow-button + keyboard teleop throttled to 20Hz, connection status, robot state, battery, velocity, emergency stop), **Settings**, **Health**
- `src/components/` - `Layout` (nav shell + shared status socket), `ui.tsx` (the design-system primitive layer), `Brand`, `TeleopPad`, `LidarView` (canvas-drawn top-down scan plot, post-Milestone-11)

**Filled in:** Milestone 9 - see [`docs/09-frontend.md`](../../docs/09-frontend.md), including the real WebRTC/ICE debugging story (mDNS + a shared-`webrtcbin` reconnect bug, later found to only be narrowed rather than closed - see that doc's "fourth pass") that verifying this against a real browser surfaced. LiDAR panel added post-Milestone-11.

## Design system

The console is built on the tokens in the repo-root [`DESIGN.md`](../../DESIGN.md), expressed as the Tailwind theme in `tailwind.config.js` rather than as raw palette classes, so nothing hardcodes a hex.

**Two surface modes, and the rule between them is fixed.** Cream (`canvas`, `surface-*`) is console chrome: navigation, page headers, telemetry, health, settings. Dark (`instrument.*`, DESIGN.md's `surface-dark` family) is a live robot surface: the camera, the LiDAR plot, the teleop pad. DESIGN.md reserves its dark surfaces for product chrome, and in this app the live machine *is* the product chrome. A panel takes a `tone`, so the split cannot drift page by page.

**Type.** Serif display (`font-display`) names pages and nothing else - it carries DESIGN.md's editorial voice at the shell level and never touches a data surface, where legibility beats voice. Live readings are mono with `tnum` (tabular figures) so digits do not reflow while telemetry polls at 2Hz.

**Coral is split by contrast duty.** DESIGN.md's `button-primary` (white 14px on `#cc785c`) measures 3.28:1, under WCAG AA. So `coral` (#cc785c) is used only where 3:1 suffices - the brand mark, the focus ring, the LiDAR marker - plus text on the dark surface, where it reads 5.47:1. Anything carrying white text uses `coral-active` (#a9583e, 5.06:1). Both are DESIGN.md tokens; the half of the pair that carries words is the darker one. Emergency stop is the console's only `error`-red element, always at the same size and place.

**Adaptations,** both documented in `tailwind.config.js`: section rhythm uses the 24/32/48 spacing tokens rather than DESIGN.md's 96px band cadence, which is a landing-page number that would push a six-panel console below the fold; and `metric-*` sizes are new, because DESIGN.md's display scale is serif with tracking tuned for Copernicus while live telemetry needs the same optical weight in tabular mono.

Fonts load from Google Fonts as the substitutes DESIGN.md itself names for the licensed Anthropic faces: Cormorant Garamond for Copernicus, Inter for StyreneB, JetBrains Mono as specified.
