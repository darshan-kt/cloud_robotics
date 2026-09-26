import { SectionDeck } from "../components/layout/SectionDeck";
import { Panel } from "../components/ui/Layout";
import { SECTIONS } from "../lib/appCatalog";

const SECTION = SECTIONS.find((s) => s.id === "sensors")!;

// Range bands, and which sensor actually returns something useful in each.
// This is the answer to "why three sensors" — no single row covers the strip,
// and the gaps are exactly where the robot has hit things.
const BANDS = ["0 – 0.15 m", "0.15 – 0.6 m", "0.6 – 3.5 m", "3.5 – 8 m", "8 – 12 m"];
const COVERAGE = [
  { sensor: "Ultrasonic", cells: ["full", "full", "full", "none", "none"], note: "Only thing that sees the bumper strip" },
  { sensor: "RPLIDAR A1", cells: ["none", "full", "full", "full", "full"], note: "One height only — 18 cm off the floor" },
  { sensor: "Orbbec Astra", cells: ["none", "none", "full", "part", "none"], note: "The only source of 3-D shape" },
];

const FILL: Record<string, string> = {
  full: "bg-nominal/70",
  part: "bg-caution/60",
  none: "bg-elevated",
};

export function SensorsDeckPage() {
  return (
    <SectionDeck
      section={SECTION}
      footer={
        <Panel
          title="Why three sensors"
          className="animate-fade-up stagger-4"
          action={<span className="font-mono text-[11px] text-faint">coverage by range band</span>}
          scroll
        >
          <div className="min-w-[560px]">
            <div className="flex items-end gap-2 pb-2">
              <span className="w-[112px] flex-none" />
              {BANDS.map((b) => (
                <span key={b} className="flex-1 text-center font-mono text-[10px] text-faint">
                  {b}
                </span>
              ))}
              <span className="w-[230px] flex-none" />
            </div>

            {COVERAGE.map((row) => (
              <div key={row.sensor} className="flex items-center gap-2 border-t border-line-soft py-2">
                <span className="w-[112px] flex-none font-sans text-body-sm text-ink">{row.sensor}</span>
                {row.cells.map((c, i) => (
                  <span key={i} className="flex-1">
                    <span className={`block h-2.5 rounded-sm ${FILL[c]}`} />
                  </span>
                ))}
                <span className="w-[230px] flex-none pl-2 font-sans text-caption text-muted">{row.note}</span>
              </div>
            ))}
          </div>

          <p className="mt-md border-t border-line-soft pt-md max-w-3xl text-pretty font-sans text-body-sm text-muted">
            No row spans the strip. The band under 0.15 m belongs to the ultrasonics alone, and it is
            the one a robot drives into things in; past 8 m only the lidar returns anything at all.
            The overlap in the middle is not redundancy for its own sake — it is where a glass door
            reads as empty floor to two of the three, and the third catches it.
          </p>
        </Panel>
      }
    />
  );
}
