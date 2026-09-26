// The wire contract, in one place. These mirror what the backend sends —
// cloud/backend/app/store.py builds the reading, app/ws/stream.py wraps it
// in a frame.

export type Kind = "string" | "int";

export interface Reading {
  device_id: string;
  kind: Kind;
  /** string readings carry a string, int readings carry a number. */
  value: string | number;
  /** Monotonic per-device counter — gaps mean dropped messages. */
  seq: number;
  recorded_at: string | null;
}

/** Sent once on connect, from the Redis ring buffer. Newest first. */
export interface BackfillFrame {
  type: "backfill";
  kind: Kind;
  readings: Reading[];
}

/** One live reading. */
export interface ReadingFrame {
  type: "reading";
  kind: Kind;
  reading: Reading;
}

/** No data for 10s — the socket is fine, the device is quiet. */
export interface IdleFrame {
  type: "idle";
  kind: Kind;
}

export type Frame = BackfillFrame | ReadingFrame | IdleFrame;

export interface LoginResponse {
  ok: boolean;
  token?: string;
  username?: string;
  error?: string;
}
