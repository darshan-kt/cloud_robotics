import { useState } from "react";
import { useReconnectingSocket } from "./useReconnectingSocket";

export interface Localisation {
  x: number;
  y: number;
  yaw: number;
  frame_id: string;
  age_s: number;
}

function isLocalisationFrame(data: unknown): data is Localisation & { type: "localisation" } {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "localisation";
}

/** /api/localisation - server->client AMCL pose, ~1 Hz. Only sent when a
 * fresh pose exists, so a null return here is a real, meaningful "no fix
 * yet", not just "hasn't loaded" - don't treat it as loading state. */
export function useLocalisation() {
  const [localisation, setLocalisation] = useState<Localisation | null>(null);
  const [connected, setConnected] = useState(false);

  useReconnectingSocket({
    path: "/api/localisation",
    onConnectedChange: setConnected,
    onMessage: (data) => {
      if (isLocalisationFrame(data)) {
        setLocalisation({ x: data.x, y: data.y, yaw: data.yaw, frame_id: data.frame_id, age_s: data.age_s });
      }
    },
  });

  return { localisation, connected };
}
