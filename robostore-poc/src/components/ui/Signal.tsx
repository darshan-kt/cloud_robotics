import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Provenance — where a number on screen actually came from.
//
// The bug this exists to make impossible: the old Dashboard showed
// "STATUS ONLINE / BATTERY 78%" (seeded IndexedDB values) directly beneath a
// header reading "ROBOT OFFLINE · GATEWAY DOWN". Both were rendered in the
// same colour, at the same weight, with no marker between them. An operator
// had no way to tell a live reading from a months-old cached one — which in
// a teleoperation console is not a cosmetic problem.
//
// So provenance is a first-class property of every displayed value, not a
// page-level afterthought. A value is one of:
//
//   live    a socket delivered it within the freshness window   → teal, breathing
//   stale   it was live, the stream went quiet                  → amber, with age
//   cached  it came from local storage, never from the robot    → amber outline
//   absent  there is no value                                   → faint, renders "—"
//
// The hard rule, enforced in Readout below: when provenance is `absent`, the
// component renders an em-dash. It will not print a remembered number. A
// console that shows a plausible stale figure is more dangerous than one
// that shows nothing, because the operator acts on it.
// ---------------------------------------------------------------------------

export type Provenance = "live" | "stale" | "cached" | "absent";

const DOT: Record<Provenance, string> = {
  live: "bg-nominal",
  stale: "bg-caution",
  cached: "border border-caution/70 bg-transparent",
  absent: "border border-faint/60 bg-transparent",
};

const TEXT: Record<Provenance, string> = {
  live: "text-nominal",
  stale: "text-caution",
  cached: "text-caution",
  absent: "text-faint",
};

const WORD: Record<Provenance, string> = {
  live: "LIVE",
  stale: "STALE",
  cached: "CACHED",
  absent: "NO SIGNAL",
};

/** Human-readable age, e.g. "4s", "12m", "3h". */
export function formatAge(since: number | null | undefined): string | null {
  if (since == null) return null;
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/** The bare marker dot. `live` is the only one that animates. */
export function SignalDot({ state, className = "" }: { state: Provenance; className?: string }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 flex-none rounded-pill ${DOT[state]} ${
        state === "live" ? "animate-breathe" : ""
      } ${className}`}
    />
  );
}

/** Dot + word, for headers and panel corners. */
export function SignalTag({
  state,
  age,
  label,
  className = "",
}: {
  state: Provenance;
  /** epoch ms of the last update; renders as a relative age */
  age?: number | null;
  /** overrides the default word (LIVE / STALE / CACHED / NO SIGNAL) */
  label?: string;
  className?: string;
}) {
  const ageText = state === "live" ? null : formatAge(age);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[1.2px] ${TEXT[state]} ${className}`}
    >
      <SignalDot state={state} />
      {label ?? WORD[state]}
      {ageText && <span className="text-faint">· {ageText}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------

interface ReadoutProps {
  label: string;
  /** The value. Ignored entirely when `state` is "absent". */
  value?: ReactNode;
  unit?: string;
  state?: Provenance;
  /** epoch ms of last update, shown as an age on non-live values */
  age?: number | null;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  /** Tints the value itself — reserve for genuine status, not decoration. */
  tone?: "default" | "nominal" | "caution" | "fault";
  className?: string;
}

const SIZE: Record<NonNullable<ReadoutProps["size"]>, string> = {
  sm: "text-readout-sm",
  md: "text-readout-md",
  lg: "text-readout-lg",
};

const TONE: Record<NonNullable<ReadoutProps["tone"]>, string> = {
  default: "text-ink",
  nominal: "text-nominal",
  caution: "text-caution",
  fault: "text-fault-bright",
};

/**
 * A labelled numeric reading with its provenance attached.
 *
 * Always prefer this over hand-rolling `<span>{value}</span>` in a page —
 * the point is that a value cannot reach the screen without declaring where
 * it came from.
 */
export function Readout({
  label,
  value,
  unit,
  state = "live",
  age,
  size = "md",
  icon,
  tone = "default",
  className = "",
}: ReadoutProps) {
  const absent = state === "absent" || value == null || value === "";

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="text-faint">{icon}</span>}
        <span className="truncate font-sans text-label uppercase text-muted">
          {label}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className={`truncate font-mono ${SIZE[size]} ${absent ? "text-faint" : TONE[tone]}`}
          // Screen readers get the provenance inline; sighted users get the tag.
          aria-label={absent ? `${label}: no signal` : undefined}
        >
          {absent ? "—" : value}
        </span>
        {!absent && unit && <span className="font-mono text-caption text-muted">{unit}</span>}
      </div>

      <SignalTag state={absent ? "absent" : state} age={age} />
    </div>
  );
}
