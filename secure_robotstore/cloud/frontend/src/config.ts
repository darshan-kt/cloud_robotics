// Where the backend lives.
//
// The real frontend (cloud-container/frontend) fetches a config.json that
// nginx generates at container start, so one built image works in any
// environment. This demo uses Vite env vars instead — simpler, and the
// tradeoff is worth naming: VITE_* values are baked in at BUILD time, so
// changing the backend URL means rebuilding the image.
//
// INTERN TASK: never put a secret in a VITE_* variable. Everything here
// ships to the browser in plain text, readable by anyone who opens
// devtools. Runtime config (the real system's approach) has the same
// property — the fix is that secrets belong on the server, not that a
// different config mechanism hides them.

const httpBase = import.meta.env.VITE_API_URL ?? "http://localhost:8001";

export const API_URL = httpBase;

/** http://host:port -> ws://host:port, preserving https -> wss. */
export const WS_URL = httpBase.replace(/^http/, "ws");

export const STRING_WS = `${WS_URL}/ws/string_api`;
export const INT_WS = `${WS_URL}/ws/int_api`;
