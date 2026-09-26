import { SectionDeck } from "../components/layout/SectionDeck";
import { Panel } from "../components/ui/Layout";
import { Chip } from "../components/ui/Layout";
import { SECTIONS } from "../lib/appCatalog";

const SECTION = SECTIONS.find((s) => s.id === "projects")!;

const COMPARE = [
  { name: "Line follower", sensors: "RGB", speed: "0.34 m/s", loop: "30 Hz", risk: "low", note: "No autonomy beyond the stripe. Cannot leave its line." },
  { name: "Object tracker", sensors: "RGB + depth", speed: "yaw only", loop: "30 Hz", risk: "low", note: "Rotates in place. Never drives toward the target." },
  { name: "Human follower", sensors: "depth + /scan", speed: "0.42 m/s", loop: "15 Hz", risk: "high", note: "The only one that follows a person. Treated accordingly." },
  { name: "Patrol loop", sensors: "all + AMCL", speed: "0.38 m/s", loop: "Nav2", risk: "med", note: "Full autonomy over a fixed route, unattended." },
];

const RISK_TONE = { low: "nominal", med: "caution", high: "fault" } as const;

export function ProjectsDeckPage() {
  return (
    <SectionDeck
      section={SECTION}
      footer={
        <Panel
          title="Side by side"
          className="animate-fade-up stagger-4"
          action={<span className="font-mono text-[11px] text-faint">risk = what a failure can reach</span>}
          scroll
        >
          <div className="min-w-[680px]">
            <div className="flex items-center gap-3 border-b border-line pb-2 font-sans text-label uppercase text-faint">
              <span className="w-[130px] flex-none">Project</span>
              <span className="w-[120px] flex-none">Sensors</span>
              <span className="w-[80px] flex-none">Speed</span>
              <span className="w-[62px] flex-none">Loop</span>
              <span className="w-[54px] flex-none">Risk</span>
              <span className="flex-1">Why</span>
            </div>
            {COMPARE.map((r) => (
              <div key={r.name} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                <span className="w-[130px] flex-none font-sans text-body-sm text-ink">{r.name}</span>
                <span className="w-[120px] flex-none font-mono text-caption text-muted">{r.sensors}</span>
                <span className="w-[80px] flex-none font-mono text-caption text-muted">{r.speed}</span>
                <span className="w-[62px] flex-none font-mono text-caption text-muted">{r.loop}</span>
                <span className="w-[54px] flex-none">
                  <Chip tone={RISK_TONE[r.risk as keyof typeof RISK_TONE]}>{r.risk}</Chip>
                </span>
                <span className="flex-1 font-sans text-caption text-muted">{r.note}</span>
              </div>
            ))}
          </div>

          <p className="mt-md border-t border-line-soft pt-md max-w-3xl text-pretty font-sans text-body-sm text-muted">
            The risk column is not about how hard each one was to build — the line follower is the
            fiddliest to tune and the least dangerous by a wide margin. It is about what a failure
            can reach. Two of these move slowly in an empty lab; one follows a person, and one drives
            a building at night with nobody watching.
          </p>
        </Panel>
      }
    />
  );
}
