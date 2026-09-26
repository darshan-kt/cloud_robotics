import { useEffect, useRef, useState } from "react";
import type { Frame, Kind, Reading } from "../api/types";

// One WebSocket, one data kind. The Remote Data page calls this twice —
// once for /ws/string_api and once for /ws/int_api — so the two windows are
// genuinely independent: either can drop and reconnect without disturbing
// the other, which is also how you can *see* that they are separate streams.
//
// Reconnect uses capped exponential backoff. A flat retry loop against a
// backend that is down turns every browser tab into a tight reconnect loop
// hammering the server exactly when it is least able to cope.

export type Status = "connecting" | "live" | "idle" | "disconnected";

const MAX_ROWS = 50;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

export interface ReadingSocket {
  readings: Reading[];
  status: Status;
  /** Most recent reading, or null before the first one arrives. */
  latest: Reading | null;
  /** Count of missing `seq` values — evidence of dropped messages. */
  dropped: number;
}

export function useReadingSocket(url: string, kind: Kind): ReadingSocket {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [dropped, setDropped] = useState(0);

  // Held in refs, not state: the socket callbacks must not re-run the
  // effect, or every message would tear down and rebuild the connection.
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const lastSeqRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled) return;
        attemptRef.current = 0; // reset backoff only on a *successful* open
        setStatus("live");
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let frame: Frame;
        try {
          frame = JSON.parse(event.data);
        } catch {
          return; // malformed frame — ignore rather than crash the stream
        }

        if (frame.type === "backfill") {
          setReadings(frame.readings.slice(0, MAX_ROWS));
          lastSeqRef.current = frame.readings[0]?.seq ?? null;
          setStatus("live");
          return;
        }

        if (frame.type === "idle") {
          // The socket is healthy; the device has gone quiet. Worth
          // distinguishing — "disconnected" would be a lie here.
          setStatus("idle");
          return;
        }

        const reading = frame.reading;

        // Sequence-gap detection. The backend stamps every reading with a
        // monotonic seq, so a jump of more than 1 is proof that messages
        // were lost between the device and this browser.
        const previous = lastSeqRef.current;
        if (previous !== null && reading.seq > previous + 1) {
          setDropped((d) => d + (reading.seq - previous - 1));
        }
        lastSeqRef.current = reading.seq;

        setStatus("live");
        // Newest first, bounded — an unbounded list would grow forever at
        // one row per second and eventually kill the tab.
        setReadings((prev) => [reading, ...prev].slice(0, MAX_ROWS));
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus("disconnected");
        const delay = Math.min(BASE_DELAY_MS * 2 ** attemptRef.current, MAX_DELAY_MS);
        attemptRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };

      // onerror always precedes onclose, so reconnect is handled there —
      // doing it in both would open two sockets per failure.
      socket.onerror = () => {};
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const socket = socketRef.current;
      if (socket) {
        socket.onclose = null; // stop the cleanup itself triggering a reconnect
        socket.close();
      }
    };
  }, [url, kind]);

  return { readings, status, latest: readings[0] ?? null, dropped };
}
