import { useEffect, useState } from "react";
import { useReconnectingSocket } from "./useReconnectingSocket";

export interface ScanFrame {
  frame_id: string;
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  range_min: number;
  range_max: number;
  ranges: (number | null)[];
}

function isScanFrame(data: unknown): data is ScanFrame & { type: "scan" } {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "scan";
}

function sendToggle(socket: WebSocket, enabled: boolean) {
  socket.send(JSON.stringify({ type: "scan_toggle", enabled }));
}

/** /api/scan - bidirectional, opt-in LIDAR stream, ~1 Hz while enabled.
 * Building a scan frame is expensive server-side, so this defaults to OFF
 * and only streams while `liveEnabled` is true - the socket itself always
 * connects (for the toggle handshake), but the server only pushes `scan`
 * frames while it's been told to. Every caller of this hook (Remote
 * Controller, Route Planner, Dashboard) must pass its own toggle state -
 * there is no shared "is anyone watching" flag across pages on purpose,
 * each page's toggle is independent. */
export function useScan(liveEnabled: boolean) {
  const [scan, setScan] = useState<ScanFrame | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useReconnectingSocket({
    path: "/api/scan",
    onConnectedChange: setConnected,
    onOpen: (socket) => sendToggle(socket, liveEnabled),
    onMessage: (data) => {
      if (isScanFrame(data)) {
        setScan(data);
      }
    },
  });

  // The onOpen above covers "on connect" (including every reconnect); this
  // covers "whenever the toggle flips" on an already-open socket.
  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendToggle(socket, liveEnabled);
    }
  }, [liveEnabled, socketRef]);

  return { scan, connected };
}
