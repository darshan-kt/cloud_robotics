import { useEffect, useState } from "react";
import { GATEWAY_URL } from "../lib/config";

// Gateway link health, measured once for the whole app.
//
// There were previously two independent implementations of this: Header's
// `useGatewayConnected` (a boolean, polled every 5s) and DashboardPage's
// page-local `useGatewayHealth` (latency + topic counts + history, polled
// every 3s). Both hit the same endpoint on their own timers, so the header
// pill and the dashboard panel could disagree about whether the link was up
// for several seconds at a time. This is the richer of the two shapes, used
// by both.

export interface GatewayHealth {
  ok: boolean;
  robotAlive: boolean;
  /** Round-trip time of the last successful poll, ms. */
  latencyMs: number | null;
  topics: Record<string, number>;
  /** Last 40 polls: 1 = reachable, 0 = not. Drives the link sparkline. */
  history: number[];
  /** epoch ms of the last *successful* poll, or null if never. */
  lastOkAt: number | null;
  /** False until the first poll resolves. */
  probed: boolean;
}

const INITIAL: GatewayHealth = {
  ok: false,
  robotAlive: false,
  latencyMs: null,
  topics: {},
  history: [],
  lastOkAt: null,
  probed: false,
};

export function useGatewayHealth(intervalMs = 3000): GatewayHealth {
  const [state, setState] = useState<GatewayHealth>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const start = performance.now();
      try {
        const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bodyJson = await res.json();
        const elapsed = performance.now() - start;
        if (cancelled) return;
        setState((s) => ({
          ok: true,
          robotAlive: !!bodyJson.robot_alive,
          latencyMs: elapsed,
          topics: bodyJson.topics ?? {},
          history: [...s.history, 1].slice(-40),
          lastOkAt: Date.now(),
          probed: true,
        }));
      } catch {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          ok: false,
          robotAlive: false,
          latencyMs: null,
          topics: {},
          history: [...s.history, 0].slice(-40),
          probed: true,
        }));
      }
    }

    poll();
    const interval = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  return state;
}
