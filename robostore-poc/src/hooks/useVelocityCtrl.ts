import { useCallback, useState } from "react";
import { useReconnectingSocket } from "./useReconnectingSocket";

/** /api/velocity_ctrl - client->server teleop command channel, ~10 Hz while
 * active. The server expects nothing back on this channel and this hook
 * doesn't parse anything from it - the caller (Remote Controller) owns
 * cadence entirely: stream while an input is held, send exactly one final
 * zero frame on release, then go quiet. This hook is just the transport;
 * see RemoteControllerPage's transmit loop for the cadence logic, and its
 * own README callout for why this endpoint also expects a server-side
 * ~400ms deadman timeout independent of what the client sends. */
export function useVelocityCtrl() {
  const [connected, setConnected] = useState(false);

  const socketRef = useReconnectingSocket({
    path: "/api/velocity_ctrl",
    onConnectedChange: setConnected,
  });

  const sendVelocity = useCallback(
    (linear: number, angular: number) => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "cmd_vel", linear, angular }));
      }
    },
    [socketRef],
  );

  return { connected, sendVelocity };
}
