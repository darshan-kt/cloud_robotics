import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "./AppShell";
import { Chip, Panel } from "../ui/Layout";
import { SignalTag } from "../ui/Signal";
import type { AppDef, SectionDef } from "../../lib/appCatalog";

// ---------------------------------------------------------------------------
// The frame every reference app page sits in.
//
// Three things it guarantees that hand-rolling each page would not:
//
// 1. A WAY BACK. Every app page carries a breadcrumb to its section deck. The
//    rail only navigates between sections, so without this an app page is a
//    dead end for anyone who arrived by link rather than by click.
// 2. HONEST PROVENANCE, ONCE. These pages carry no live robot data — there is
//    no gateway behind them (see README, "Two data layers"). Rather than let
//    seventeen pages each decide how to admit that, the frame states it in one
//    place, in the same vocabulary the live pages use.
// 3. One heading treatment, so a section of thirteen new pages doesn't drift
//    into thirteen slightly different layouts.
// ---------------------------------------------------------------------------

export function AppPage({
  app,
  section,
  /** One line under the title. What this page is for, plainly. */
  summary,
  /** Short spec pairs rendered in the header rail, e.g. part number, rate. */
  facts,
  children,
}: {
  app: AppDef;
  section: SectionDef;
  summary: string;
  facts?: Array<{ label: string; value: string }>;
  children: ReactNode;
}) {
  const Icon = app.icon;

  return (
    <AppShell title={app.title}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-lg">
        {/* ---- Header --------------------------------------------------- */}
        <header className="animate-fade-up flex flex-col gap-md">
          <Link
            to={section.route}
            className="inline-flex w-fit items-center gap-1 rounded-sm font-sans text-caption text-faint transition-colors hover:text-coral"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {section.title}
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-lg">
            <div className="flex min-w-0 items-start gap-md">
              <span className="lit flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-line bg-raised text-coral">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="text-balance font-display text-display-md text-ink">{app.title}</h1>
                <p className="mt-1.5 max-w-2xl text-pretty font-sans text-body-sm text-muted">{summary}</p>
              </div>
            </div>

            <div className="flex flex-none flex-col items-start gap-2 sm:items-end">
              <Chip tone="brand">{section.title}</Chip>
              <SignalTag state="cached" label={app.signal} />
            </div>
          </div>

          {facts && facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-panel sm:grid-cols-4">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col gap-1 bg-surface px-md py-sm">
                  <dt className="font-sans text-label uppercase text-muted">{f.label}</dt>
                  <dd className="break-words font-mono text-readout-sm text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>

        {children}

        {/* ---- The standing caveat -------------------------------------- */}
        <Panel className="animate-fade-up stagger-4 border-caution/25">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-sm bg-caution/10 font-mono text-[11px] text-caution">
              i
            </span>
            <p className="font-sans text-body-sm text-muted">
              Reference page. Every figure here comes from a datasheet, a recorded bag file or a
              bench run — none of it is streaming from a robot right now, which is why the tag above
              reads <span className="font-mono text-caution">{app.signal}</span> rather than{" "}
              <span className="font-mono text-nominal">LIVE</span>. Nothing on this page can command
              the vehicle.
            </p>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

// ---- Small shared pieces the reference pages reuse ------------------------

/** A labelled spec row. Sans label, mono value — same contract as KeyValue. */
export function Spec({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-lg border-b border-line-soft py-2 last:border-0">
      <span className="flex-none font-sans text-body-sm text-muted">{k}</span>
      <span className="truncate text-right font-mono text-body-sm text-body">{v}</span>
    </div>
  );
}

/** A ROS 2 interface line: topic name, type, and rate. */
export function Topic({
  name,
  type,
  rate,
  dir = "pub",
}: {
  name: string;
  type: string;
  rate?: string;
  dir?: "pub" | "sub";
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2 last:border-0">
      <span
        className={`flex-none rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[1px] ${
          dir === "pub" ? "bg-nominal/10 text-nominal" : "bg-coral/10 text-coral"
        }`}
      >
        {dir}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink">{name}</code>
      <span className="truncate font-mono text-caption text-faint">{type}</span>
      {rate && <span className="flex-none font-mono text-caption text-muted">{rate}</span>}
    </div>
  );
}

/** A numbered step in a tuning or bring-up procedure. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 border-b border-line-soft pb-3 last:border-0 last:pb-0">
      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-sm bg-elevated font-mono text-[10px] text-coral">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-sans text-body-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-pretty font-sans text-body-sm text-muted">{children}</p>
      </div>
    </li>
  );
}
