import { useNavigate } from "react-router-dom";
import { INT_WS, STRING_WS } from "../config";
import { useAuth } from "../hooks/useAuth";
import { useReadingSocket, type ReadingSocket, type Status } from "../hooks/useReadingSocket";
import type { Reading } from "../api/types";

// Remote Data — the whole app, two windows side by side.
//
//   left   /ws/string_api  string messages
//   right  /ws/int_api     integer messages
//
// They are separate WebSockets on purpose. It would be less code to
// multiplex both kinds over one socket, but two makes the architecture
// legible: you can kill one stream (stop the broker, break one topic) and
// watch exactly one window go stale while the other keeps running.

const STATUS_STYLE: Record<Status, { dot: string; text: string; label: string }> = {
  connecting: { dot: "bg-caution", text: "text-caution", label: "CONNECTING" },
  live: { dot: "bg-nominal animate-pulse", text: "text-nominal", label: "LIVE" },
  idle: { dot: "bg-caution", text: "text-caution", label: "NO DATA 10s" },
  disconnected: { dot: "bg-fault", text: "text-fault", label: "DISCONNECTED" },
};

export function RemoteDataPage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();

  const stringStream = useReadingSocket(STRING_WS, "string");
  const intStream = useReadingSocket(INT_WS, "int");

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-none items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[1.5px] text-coral">
            secure_robotstore
          </span>
          <span className="h-3 w-px bg-line" />
          <h1 className="text-sm font-medium text-ink">Remote Data</h1>
        </div>

        <div className="flex items-center gap-4">
          {session && <span className="text-xs text-faint">{session.username}</span>}
          <button
            onClick={handleSignOut}
            className="rounded-md border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-faint hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <DataWindow
          title="String messages"
          endpoint="/ws/string_api"
          stream={stringStream}
          renderValue={(r) => <span className="text-ink">{String(r.value)}</span>}
        />
        <DataWindow
          title="Integer messages"
          endpoint="/ws/int_api"
          stream={intStream}
          renderValue={(r) => <IntValue value={Number(r.value)} />}
        />
      </main>
    </div>
  );
}

// ---- One window ----------------------------------------------------------

function DataWindow({
  title,
  endpoint,
  stream,
  renderValue,
}: {
  title: string;
  endpoint: string;
  stream: ReadingSocket;
  renderValue: (reading: Reading) => React.ReactNode;
}) {
  const status = STATUS_STYLE[stream.status];

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-line bg-surface">
      <div className="flex flex-none items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          <code className="font-mono text-[11px] text-faint">{endpoint}</code>
        </div>
        <span className={`flex items-center gap-1.5 font-mono text-[11px] ${status.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>

      {/* Current value, big enough to read from across the room. */}
      <div className="flex-none border-b border-line px-4 py-4">
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[1.5px] text-muted">
          Latest
        </p>
        <div className="font-mono text-2xl">
          {stream.latest ? renderValue(stream.latest) : <span className="text-faint">—</span>}
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-faint">
          <span>seq {stream.latest?.seq ?? "—"}</span>
          <span aria-hidden>·</span>
          <span>{stream.readings.length} buffered</span>
          {/* Only shown when non-zero, so it reads as a real signal rather
              than a permanent zero nobody looks at. */}
          {stream.dropped > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-caution">{stream.dropped} dropped</span>
            </>
          )}
        </div>
      </div>

      {/* History. min-h-0 is what lets this scroll inside the flex column
          instead of pushing the page taller. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {stream.readings.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-faint">
            Waiting for the first message…
          </p>
        ) : (
          <ul>
            {stream.readings.map((reading) => (
              <li
                key={`${reading.seq}-${reading.recorded_at}`}
                className="flex items-baseline justify-between gap-4 border-b border-line/50 px-4 py-2 last:border-0"
              >
                <span className="font-mono text-xs text-faint">
                  {formatTime(reading.recorded_at)}
                </span>
                <span className="flex-1 truncate text-right font-mono text-sm text-body">
                  {String(reading.value)}
                </span>
                <span className="w-12 text-right font-mono text-[11px] text-faint">
                  #{reading.seq}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---- bits ----------------------------------------------------------------

/** The integer gets a bar as well as a number — a trend is easier to read
 *  than a value that changes once a second. */
function IntValue({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <span className="text-ink">{value}</span>
      <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-coral transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString();
}
