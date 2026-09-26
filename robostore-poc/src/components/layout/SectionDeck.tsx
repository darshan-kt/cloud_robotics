import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AppShell } from "./AppShell";
import { SectionTitle } from "../ui/Layout";
import { SignalTag, type Provenance } from "../ui/Signal";
import type { AppDef, SectionDef } from "../../lib/appCatalog";

// ---------------------------------------------------------------------------
// One deck page per rail section, rendered from the catalog.
//
// The four sections have genuinely different shapes — three are a flat grid of
// four apps, and "AI & robotics" is two named groups of three and two. Rather
// than write four near-identical pages, this renders whatever the catalog
// declares: a group with no `title` becomes a bare grid, a group with one gets
// a labelled band. Adding a fifth section is a catalog entry, not a component.
// ---------------------------------------------------------------------------

export function SectionDeck({
  section,
  children,
  footer,
}: {
  section: SectionDef;
  /** Rendered above the app grid — a vitals strip, a summary. */
  children?: React.ReactNode;
  /** Rendered below the app grid — an activity log. */
  footer?: React.ReactNode;
}) {
  const count = section.groups.reduce((n, g) => n + g.apps.length, 0);

  return (
    <AppShell title={section.title}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-xl">
        <header className="animate-fade-up">
          <SectionTitle
            eyebrow={
              <>
                <section.icon className="h-3.5 w-3.5 text-coral" />
                {section.eyebrow}
              </>
            }
            title={section.title}
            description={section.description}
            action={
              <span className="font-mono text-[11px] text-faint">
                {count} app{count === 1 ? "" : "s"}
              </span>
            }
          />
        </header>

        {/* Anything the section wants above its apps — a summary strip, a
            vitals row. Only the control deck uses this today. */}
        {children}

        {section.groups.map((group, gi) => (
          <section key={group.id} className={`animate-fade-up stagger-${Math.min(gi + 2, 5)} flex flex-col gap-md`}>
            {group.title && (
              <div className="flex flex-col gap-1 border-l-2 border-coral/40 pl-md">
                <h3 className="font-sans text-title-md text-ink">{group.title}</h3>
                {group.description && (
                  <p className="max-w-2xl font-sans text-body-sm text-muted">{group.description}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
              {group.apps.map((app, i) => (
                <AppTile key={app.id} app={app} index={i} />
              ))}
            </div>
          </section>
        ))}

        {footer}
      </div>
    </AppShell>
  );
}

// ---- Tile -----------------------------------------------------------------

export function AppTile({
  app,
  index,
  status,
}: {
  app: AppDef;
  index: number;
  /**
   * Overrides the catalog's static footer label. The control deck passes a
   * real state here (gateway up, e-stop engaged); reference pages have no
   * live state to report, so they fall back to the catalog's honest
   * "SPEC SHEET" / "RECORDED BAG" wording rather than inventing one.
   */
  status?: { state: Provenance; label: string };
}) {
  const Icon = app.icon;
  const footer = status ?? { state: "cached" as Provenance, label: app.signal };

  return (
    <Link
      to={app.route}
      className={[
        "group flex flex-col rounded-lg border bg-surface p-lg shadow-panel",
        "transition-[border-color,transform,box-shadow] duration-200",
        "hover:-translate-y-px hover:shadow-raise active:translate-y-0",
        `animate-fade-up stagger-${Math.min(index + 1, 5)}`,
        app.safety && footer.label === "ENGAGED"
          ? "border-fault/50 hover:border-fault"
          : app.safety
            ? "border-fault/40 hover:border-fault"
            : "border-line hover:border-faint/50",
      ].join(" ")}
    >
      <div className="mb-md flex items-start justify-between">
        <span
          className={[
            "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
            app.safety
              ? "bg-fault/15 text-fault-bright"
              : "bg-elevated text-muted group-hover:bg-coral/10 group-hover:text-coral",
          ].join(" ")}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <ArrowRight className="h-4 w-4 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-coral" />
      </div>

      <h4 className="font-sans text-title-sm text-ink">{app.title}</h4>
      <p className="mt-1.5 flex-1 text-pretty font-sans text-body-sm text-muted">{app.blurb}</p>

      {/* The footer keeps the tile grid's baselines aligned regardless of how
          long the blurb above it wrapped. */}
      <div className="mt-md border-t border-line-soft pt-sm">
        <SignalTag state={footer.state} label={footer.label} />
      </div>
    </Link>
  );
}
