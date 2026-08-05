import { useEffect, useRef, type RefObject } from "react";
import { GATEWAY_URL } from "../lib/config";

// The reconnect-with-backoff shell shared by every WebSocket-driven hook in
// this app (useTelemetry, useLocalisation, usePlan, useScan,
// useVelocityCtrl) - one implementation instead of five copies of the same
// "2s -> x1.5 -> capped 10s" reconnect logic. Each specific hook still owns
// its own message shape/typing and lives in its own file, matching the
// build brief's project structure - only the mechanics are shared here.

const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 10000;
const BACKOFF_MULTIPLIER = 1.5;

/** Swaps http(s) -> ws(s) in a base URL and appends a path. Exported because
 * RemoteControllerPage's hand-rolled inline telemetry socket (see its own
 * README callout for why it doesn't use useTelemetry) still needs this same
 * URL construction - no reason to duplicate a one-line string transform. */
export function toWsUrl(base: string, path: string): string {
  return base.replace(/^http/, "ws") + path;
}

interface ReconnectingSocketOptions {
  path: string;
  /** Fires every time a new socket finishes connecting - including after a
   * reconnect, not just the first time. Useful for "announce state on
   * connect" handshakes (see useScan's scan_toggle). */
  onOpen?: (socket: WebSocket) => void;
  /** Parsed JSON payload of every inbound frame. Malformed frames are
   * discarded before this ever fires - callers only see valid JSON. */
  onMessage?: (data: unknown) => void;
  onConnectedChange: (connected: boolean) => void;
}

export function useReconnectingSocket({
  path,
  onOpen,
  onMessage,
  onConnectedChange,
}: ReconnectingSocketOptions): RefObject<WebSocket | null> {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);

  // Keep the latest callbacks in refs so the connect effect below doesn't
  // need them as dependencies - they're frequently inline arrow functions
  // that would otherwise force a full disconnect/reconnect on every render.
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  const onConnectedChangeRef = useRef(onConnectedChange);
  onOpenRef.current = onOpen;
  onMessageRef.current = onMessage;
  onConnectedChangeRef.current = onConnectedChange;

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const existing = socketRef.current;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const socket = new WebSocket(toWsUrl(GATEWAY_URL, path));
      socketRef.current = socket;

      socket.onopen = () => {
        backoffRef.current = INITIAL_BACKOFF_MS;
        onConnectedChangeRef.current(true);
        onOpenRef.current?.(socket);
      };

      socket.onmessage = (event) => {
        try {
          onMessageRef.current?.(JSON.parse(event.data));
        } catch {
          // Malformed frame - discard silently, per the build brief.
        }
      };

      socket.onclose = () => {
        onConnectedChangeRef.current(false);
        socketRef.current = null;
        if (cancelled) return;
        reconnectTimeoutRef.current = window.setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      };

      // onclose always fires right after a connection-establishment error in
      // browsers - no separate handling needed here, but an empty handler
      // suppresses the default "Uncaught" console noise for the event itself.
      socket.onerror = () => {};
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      const socket = socketRef.current;
      if (socket) {
        socket.onclose = null; // don't let the reconnect loop fire post-unmount
        socket.close();
      }
      socketRef.current = null;
    };
  }, [path]);

  return socketRef;
}
