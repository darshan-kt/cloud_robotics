import { useState } from "react";
import { useReconnectingSocket } from "./useReconnectingSocket";

export interface Telemetry {
  x: number;
  y: number;
  theta: number;
}

function isTelemetryFrame(data: unknown): data is Telemetry & { type: "telemetry" } {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "telemetry";
}

/** /api/telemetry - server->client odometry, ~1 Hz. theta is yaw in radians. */
export function useTelemetry() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [connected, setConnected] = useState(false);

  useReconnectingSocket({
    path: "/api/telemetry",
    onConnectedChange: setConnected,
    onMessage: (data) => {
      if (isTelemetryFrame(data)) {
        setTelemetry({ x: data.x, y: data.y, theta: data.theta });
      }
    },
  });

  return { telemetry, connected };
}
