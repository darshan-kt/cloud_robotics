// The real-time gateway ROBOSTORE's live-data hooks will eventually talk to.
//
// Phase 1 (now): this doesn't point at anything real yet — ROBOSTORE's app
// pages are being built one at a time, and none of them need live robot data
// until they exist. Header's connection pill will simply show "Not
// Connected" against this default, which is honest: there's nothing there.
//
// Phase 2 (when an app needs real lidar/camera/command data): point this at
// the *existing* cloud-container FastAPI backend instead of standing up a
// new bespoke gateway — it already exposes robot telemetry, lidar and teleop
// (see ../../../docs/api-reference.md and ../../../docs/configuration-reference.md).
// The five WebSocket hooks described in the build brief become thin adapters
// over that existing contract rather than a second backend to maintain.
export const GATEWAY_URL =
  import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:1717";
