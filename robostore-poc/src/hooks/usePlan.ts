import { useState } from "react";
import { useReconnectingSocket } from "./useReconnectingSocket";

export interface PlanPoint {
  x: number;
  y: number;
}

export interface Plan {
  frame_id: string;
  age_s: number;
  points: PlanPoint[];
}

function isPlanFrame(data: unknown): data is Plan & { type: "plan" } {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "plan";
}

/** /api/plan - server->client active Nav2 global plan, ~2 Hz. Empty
 * `points` means "no active plan", not "not connected yet" - callers that
 * derive a "mission active" flag should check `points.length > 0`. */
export function usePlan() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [connected, setConnected] = useState(false);

  useReconnectingSocket({
    path: "/api/plan",
    onConnectedChange: setConnected,
    onMessage: (data) => {
      if (isPlanFrame(data)) {
        setPlan({ frame_id: data.frame_id, age_s: data.age_s, points: data.points });
      }
    },
  });

  return { plan, connected };
}
