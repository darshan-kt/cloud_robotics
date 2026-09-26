import type { ReactNode } from "react";
import { AppPage, Spec, Step } from "../../components/layout/AppPage";
import { Panel } from "../../components/ui/Layout";
import { Readout } from "../../components/ui/Signal";
import { Pipeline, Sparkline } from "../../components/ui/Viz";
import type { AppDef, SectionDef } from "../../lib/appCatalog";

// ---------------------------------------------------------------------------
// The four behaviour packages genuinely share a shape: sensors in, a state
// machine, a velocity command out, and a bench run that says how well it held.
// Writing four near-identical pages would guarantee they drift apart; this
// template fixes the shape and each project supplies only what differs.
//
// `extra` exists so a project can add the one panel the others don't need
// (the patrol schedule, the tracker's lock criteria) without the template
// growing a flag per project.
// ---------------------------------------------------------------------------

export interface ProjectMetric {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "nominal" | "caution" | "fault";
}

export interface ProjectSpec {
  app: AppDef;
  section: SectionDef;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  /** Left-to-right processing chain. Four or five stages reads best. */
  stages: Array<{ name: string; detail: string }>;
  /** Numbered explanation of the control loop. */
  steps: Array<{ title: string; body: ReactNode }>;
  /** Gains and thresholds someone would actually retune on a new floor. */
  params: Array<{ k: string; v: string }>;
  /** Headline numbers from the bench run. */
  metrics: ProjectMetric[];
  /** Per-run trace under the metrics — error, distance, whatever the run tracked. */
  trace: { values: number[]; caption: string; tone?: string };
  /** Honest list of what breaks it. */
  failures: Array<{ title: string; body: ReactNode }>;
  extra?: ReactNode;
}

export function ProjectTemplate(p: ProjectSpec) {
  return (
    <AppPage app={p.app} section={p.section} summary={p.summary} facts={p.facts}>
      <Panel title="Processing chain" scroll>
        <div className="min-w-[560px]">
          <Pipeline stages={p.stages} label={`${p.app.title} pipeline: ${p.stages.map((s) => s.name).join(" then ")}`} />
        </div>
      </Panel>

      <div className="grid items-start gap-lg lg:grid-cols-[1.25fr_1fr]">
        <Panel title="How the loop runs">
          <ol className="flex flex-col gap-3">
            {p.steps.map((s, i) => (
              <Step key={s.title} n={i + 1} title={s.title}>
                {s.body}
              </Step>
            ))}
          </ol>
        </Panel>

        <div className="flex flex-col gap-lg">
          <Panel title="Tuned parameters">
            {p.params.map((x) => (
              <Spec key={x.k} k={x.k} v={x.v} />
            ))}
          </Panel>
          {p.extra}
        </div>
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-[1fr_1.1fr]">
        <Panel title="Bench run" action={<span className="font-mono text-[11px] text-faint">lab floor · 20 min</span>}>
          <div className="grid grid-cols-2 gap-lg">
            {p.metrics.map((m) => (
              <Readout
                key={m.label}
                label={m.label}
                value={m.value}
                unit={m.unit}
                size="lg"
                state="cached"
                tone={m.tone ?? "default"}
              />
            ))}
          </div>
          <div className="mt-md border-t border-line-soft pt-md">
            <Sparkline values={p.trace.values} label={p.trace.caption} tone={p.trace.tone} />
            <p className="mt-2 text-pretty font-sans text-caption text-faint">{p.trace.caption}</p>
          </div>
        </Panel>

        <Panel title="What breaks it" tone="caution">
          <ul className="flex flex-col gap-3">
            {p.failures.map((f) => (
              <li key={f.title} className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
                <p className="font-sans text-body-sm font-medium text-ink">{f.title}</p>
                <p className="mt-0.5 text-pretty font-sans text-body-sm text-muted">{f.body}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppPage>
  );
}
