import type { ReactNode } from "react";
import { AppPage, Spec } from "../../components/layout/AppPage";
import { Panel } from "../../components/ui/Layout";
import { Readout } from "../../components/ui/Signal";
import { Curve, type CurveMarker } from "../../components/ui/Viz";
import type { AppDef, SectionDef } from "../../lib/appCatalog";

// ---------------------------------------------------------------------------
// The three distribution pages share a frame: the density, the algebra, the
// moments, and — the part that makes this a robotics page rather than a
// statistics one — where the assumption is actually made in this platform's
// code, and what breaks when it is wrong.
//
// The curve is evaluated from the real PDF (see each page's `pdf`), not traced
// by hand. A hand-drawn Gaussian is always subtly wrong in the tails, which is
// exactly the region the page is trying to talk about.
// ---------------------------------------------------------------------------

export interface DistributionSpec {
  app: AppDef;
  section: SectionDef;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  /** The density, evaluated over `domain`. */
  pdf: (x: number) => number;
  domain: [number, number];
  markers?: CurveMarker[];
  xLabel: string;
  /** Written in plain notation — this project has no maths renderer. */
  formula: string;
  support: string;
  params: Array<{ k: string; v: string }>;
  moments: Array<{ label: string; value: string }>;
  /** The whole point of the page. */
  usedFor: { where: string; body: ReactNode };
  breaks: { body: ReactNode };
  sampling: string;
}

export function DistributionTemplate(d: DistributionSpec) {
  return (
    <AppPage app={d.app} section={d.section} summary={d.summary} facts={d.facts}>
      <div className="grid items-start gap-lg lg:grid-cols-[1.35fr_1fr]">
        <Panel title="Probability density">
          <Curve
            fn={d.pdf}
            domain={d.domain}
            markers={d.markers}
            xLabel={d.xLabel}
            label={`Probability density function of the ${d.app.title.toLowerCase()} distribution`}
          />
        </Panel>

        <div className="flex flex-col gap-lg">
          <Panel title="Definition">
            <div className="rounded-md border border-line bg-canvas px-md py-sm">
              <code className="font-mono text-body-sm text-ink">{d.formula}</code>
            </div>
            <p className="mt-2 font-mono text-caption text-faint">support: {d.support}</p>
            <div className="mt-md">
              {d.params.map((p) => (
                <Spec key={p.k} k={p.k} v={p.v} />
              ))}
            </div>
          </Panel>

          <Panel title="Moments">
            <div className="grid grid-cols-2 gap-lg">
              {d.moments.map((m) => (
                <Readout key={m.label} label={m.label} value={m.value} state="cached" />
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-2">
        <Panel title={`Where this appears: ${d.usedFor.where}`}>
          <div className="text-pretty font-sans text-body-sm text-muted">{d.usedFor.body}</div>
        </Panel>

        <Panel title="What breaks when the assumption is wrong" tone="caution">
          <div className="text-pretty font-sans text-body-sm text-muted">{d.breaks.body}</div>
        </Panel>
      </div>

      <Panel title="Drawing samples">
        <code className="block whitespace-pre-wrap font-mono text-body-sm text-body">{d.sampling}</code>
      </Panel>
    </AppPage>
  );
}
