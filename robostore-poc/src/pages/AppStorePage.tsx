import { useEffect, useState } from "react";
import { Battery, Cpu, OctagonX, Radio, Timer } from "lucide-react";
import { AppShell, SpikeMark } from "../components/layout/AppShell";
import { AppTile } from "../components/layout/SectionDeck";
import { SECTIONS } from "../lib/appCatalog";
import { Chip, Panel, Skeleton } from "../components/ui/Layout";
import { EventLog } from "../components/ui/EventLog";
import { Readout, type Provenance } from "../components/ui/Signal";
import { useEmergencyStop } from "../hooks/useEmergencyStop";
import { useGatewayHealth } from "../hooks/useGatewayHealth";
import * as localDb from "../lib/localDb";
import type { MapData, Robot, RobotSensor } from "../types";

// The deck — the first screen an operator sees after signing in.
//
// It used to be a launcher: a hue-panning "Choose your tool" headline, a
// marquee of hardcoded strings ("ALL SYSTEMS NOMINAL", "GATEWAY: STANDBY")
// that scrolled cheerfully while the header said NOT CONNECTED, and four
// tiles in four different colours. The most valuable screen in the app
// carried no information about the robot.
//
// Now the top half is the vehicle: who it is, and the four numbers you'd
// want before you touch anything, each tagged with where it came from. The
// tiles below are still the way in to each tool, but every tile reports its
// own live state, so the deck answers "what is going on" before it asks
// "what do you want to open".

// The four control apps come from the catalog (src/lib/appCatalog.ts), which
// also feeds the rail and the route table. This deck adds what the catalog
// cannot know: each tool's state right now.
const CONTROL_APPS = SECTIONS.find((sec) => sec.id === "control")!.groups[0].apps;

interface DeckData {
  robot: Robot | null;
  sensors: RobotSensor[];
  maps: MapData[];
  loading: boolean;
}

function useDeckData(): DeckData {
  const [state, setState] = useState<DeckData>({
    robot: null,
    sensors: [],
    maps: [],
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const robot = await localDb.getRobot();
      const [sensors, maps] = await Promise.all([localDb.getSensors(robot.id), localDb.getMaps()]);
      if (!cancelled) setState({ robot, sensors, maps, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function AppStorePage() {
  const { robot, sensors, maps, loading } = useDeckData();
  const gateway = useGatewayHealth();
  const estop = useEmergencyStop();

  // Provenance for the vitals row. Nothing here streams from the robot yet
  // (see README §"Two data layers"), so these values are honestly CACHED
  // whenever the gateway is down — never dressed up as live.
  const vitals: Provenance = gateway.ok && gateway.robotAlive ? "live" : "cached";
  const cachedAt = robot ? Date.parse(robot.updated_at) : null;

  const offlineSensors = sensors.filter((s) => s.status === "offline").length;

  return (
    <AppShell title="Robot control">
      <div className="mx-auto flex h-full max-w-[1200px] flex-col gap-lg">
        {/* ---- The vehicle ------------------------------------------------ */}
        <section className="animate-fade-up flex-none">
          <div className="flex flex-wrap items-end justify-between gap-lg">
            <div className="min-w-0">
              <p className="mb-1.5 flex items-center gap-2 font-sans text-label uppercase text-muted">
                <SpikeMark className="h-3 w-3 text-coral" />
                Connected vehicle
              </p>
              {loading ? (
                <Skeleton className="h-11 w-72" />
              ) : (
                <h2 className="font-display text-display-lg text-ink">{robot?.name}</h2>
              )}
              <p className="mt-1.5 font-mono text-caption text-faint">
                {robot ? `${robot.model} · ${robot.serial_number} · fw ${robot.firmware_version}` : "—"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={estop.isActive ? "fault" : "nominal"} icon={<OctagonX className="h-3 w-3" />}>
                {estop.isActive ? "E-Stop engaged" : "E-Stop clear"}
              </Chip>
              <Chip tone={gateway.ok ? "nominal" : "caution"} icon={<Radio className="h-3 w-3" />}>
                {gateway.ok ? "Gateway up" : "Gateway down"}
              </Chip>
            </div>
          </div>
        </section>

        {/* ---- Vitals ------------------------------------------------------
            Four readings, each carrying its own provenance. When the gateway
            is down these read CACHED with an age, and `pose` reads NO SIGNAL
            rather than inventing a coordinate. */}
        <section className="animate-fade-up stagger-1 grid flex-none grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-panel lg:grid-cols-4">
          <VitalCell>
            <Readout
              size="lg"
              label="Battery"
              value={robot ? robot.battery_level : null}
              unit="%"
              icon={<Battery className="h-3.5 w-3.5" />}
              state={loading ? "absent" : vitals}
              age={cachedAt}
              tone={robot && robot.battery_level < 20 ? "caution" : "default"}
            />
          </VitalCell>
          <VitalCell>
            <Readout
              size="lg"
              label="Uptime"
              value={robot ? robot.uptime_hours.toFixed(1) : null}
              unit="h"
              icon={<Timer className="h-3.5 w-3.5" />}
              state={loading ? "absent" : vitals}
              age={cachedAt}
            />
          </VitalCell>
          <VitalCell>
            <Readout
              size="lg"
              label="Pose"
              // No AMCL fix without a gateway — so there is deliberately no
              // value to show here until one exists.
              value={gateway.ok && gateway.robotAlive ? "0.00, 0.00" : null}
              icon={<Cpu className="h-3.5 w-3.5" />}
              state="absent"
            />
          </VitalCell>
          <VitalCell>
            <Readout
              size="lg"
              label="Sensors online"
              value={loading ? null : `${sensors.length - offlineSensors}/${sensors.length}`}
              icon={<Radio className="h-3.5 w-3.5" />}
              state={loading ? "absent" : "cached"}
              age={cachedAt}
              tone={offlineSensors > 0 ? "caution" : "nominal"}
            />
          </VitalCell>
        </section>

        {/* ---- Tools ------------------------------------------------------ */}
        <section className="animate-fade-up stagger-2 flex flex-none flex-col gap-md">
          <div className="flex items-baseline justify-between gap-lg">
            <h3 className="font-sans text-label uppercase text-muted">
              Operator tools
            </h3>
            <span className="font-mono text-[11px] text-faint">{CONTROL_APPS.length} installed</span>
          </div>

          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
            {CONTROL_APPS.map((app, i) => (
              <AppTile
                key={app.id}
                app={app}
                index={i}
                status={statusFor(app.id, {
                  gateway: gateway.ok,
                  estopActive: estop.isActive,
                  offlineSensors,
                  sensorCount: sensors.length,
                  mapCount: maps.length,
                  estopEvents: estop.history.length,
                  loading,
                })}
              />
            ))}
          </div>
        </section>

        {/* ---- Recent activity ------------------------------------------
            The deck's trailing space carries the robot's safety log rather
            than empty canvas. */}
        <Panel
          title="Recent activity"
          className="animate-fade-up stagger-3 min-h-[140px] flex-1"
          scroll
          action={
            <span className="font-mono text-[11px] text-faint">
              {estop.history.length} event{estop.history.length === 1 ? "" : "s"}
            </span>
          }
        >
          <EventLog
            events={estop.history}
            limit={6}
            emptyDescription="Emergency-stop triggers and releases will appear here as they happen."
          />
        </Panel>
      </div>
    </AppShell>
  );
}

function VitalCell({ children }: { children: React.ReactNode }) {
  // Hairline grid: cells sit on a `bg-line` parent with a 1px gap, so the
  // dividers are the background showing through rather than eight borders
  // that have to agree with each other.
  // Readouts step down one size on phones so a value like "132.5 h" fits a
  // half-width cell instead of truncating.
  return (
    <div className="bg-surface p-md sm:p-lg max-sm:[&_.text-readout-lg]:text-readout-md">{children}</div>
  );
}

// ---- Per-tile live status -------------------------------------------------

interface StatusInput {
  gateway: boolean;
  estopActive: boolean;
  offlineSensors: number;
  sensorCount: number;
  mapCount: number;
  estopEvents: number;
  loading: boolean;
}

interface TileStatus {
  state: Provenance;
  label: string;
}

/** What each tool has to say for itself right now. */
function statusFor(id: string, d: StatusInput): TileStatus {
  if (d.loading) return { state: "absent", label: "CHECKING" };
  switch (id) {
    case "dashboard":
      return d.offlineSensors > 0
        ? { state: "stale", label: `${d.offlineSensors} SENSOR OFFLINE` }
        : { state: "cached", label: `${d.sensorCount} SENSORS OK` };
    case "remote-control":
      return d.gateway
        ? { state: "live", label: "READY TO DRIVE" }
        : { state: "absent", label: "NO CONTROL LINK" };
    case "route-planner":
      return { state: "cached", label: `${d.mapCount} MAP${d.mapCount === 1 ? "" : "S"}` };
    case "emergency-stop":
      return d.estopActive
        ? { state: "stale", label: "ENGAGED" }
        : { state: "cached", label: `ARMED · ${d.estopEvents} EVENTS` };
    default:
      return { state: "absent", label: "UNKNOWN" };
  }
}
