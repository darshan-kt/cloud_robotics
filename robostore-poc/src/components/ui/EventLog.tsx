import { OctagonX } from "lucide-react";
import { EmptyState } from "./Layout";
import type { EmergencyStop } from "../../types";

// The emergency-stop audit trail, rendered the same way everywhere it
// appears — the E-Stop page, the deck, and the dashboard's robot tab.
//
// It was previously inlined in EmergencyStopPage only. Lifting it out is
// what lets the deck and the dashboard fill their trailing space with
// something an operator actually wants (what has happened to this robot
// recently) instead of stretching tiles to cover empty background.

export function EventLog({
  events,
  limit,
  emptyDescription = "Every trigger and release is logged here with its reason and timestamp.",
}: {
  events: EmergencyStop[];
  /** Render at most this many, newest first. */
  limit?: number;
  emptyDescription?: string;
}) {
  const shown = limit ? events.slice(0, limit) : events;

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={<OctagonX className="h-6 w-6" />}
        title="No events recorded"
        description={emptyDescription}
        className="py-lg"
      />
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {shown.map((entry) => (
        <li
          key={entry.id}
          className={`rounded-md border-y border-r border-l-2 border-line bg-raised p-sm ${
            entry.is_active ? "border-l-fault" : "border-l-nominal"
          }`}
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span
              className={`font-sans text-label uppercase ${
                entry.is_active ? "text-fault-bright" : "text-nominal"
              }`}
            >
              {entry.is_active ? "Triggered" : "Released"}
            </span>
            <time className="flex-none font-mono text-[11px] text-faint">
              {new Date(entry.created_at).toLocaleTimeString()}
            </time>
          </div>
          <p className="font-sans text-caption text-muted">{entry.reason}</p>
        </li>
      ))}
    </ol>
  );
}
