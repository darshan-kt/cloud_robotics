import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Camera,
  Check,
  Clock,
  Cog,
  Compass,
  Crosshair,
  Pencil,
  Radar,
  Waves,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { Chip, EmptyState, KeyValue, Panel, Skeleton, inputClass } from "../components/ui/Layout";
import { EventLog } from "../components/ui/EventLog";
import { Readout, SignalTag, type Provenance } from "../components/ui/Signal";
import { useToast } from "../components/ui/Toast";
import { clamp } from "../lib/utils";
import * as localDb from "../lib/localDb";
import type { EmergencyStop, Robot, RobotSensor } from "../types";
import { useScan, type ScanFrame } from "../hooks/useScan";
import { useTelemetry, type Telemetry } from "../hooks/useTelemetry";
import { useLocalisation } from "../hooks/useLocalisation";
import { usePlan } from "../hooks/usePlan";
import { useGatewayHealth, type GatewayHealth } from "../hooks/useGatewayHealth";
import { useEmergencyStop } from "../hooks/useEmergencyStop";

// The dashboard's central honesty problem, now fixed:
//
// It rendered a live strip reading "ROBOT OFFLINE · GATEWAY DOWN" directly
// above four metric cards reading "STATUS ONLINE · BATTERY 78% · UPTIME
// 132.5h" — the first row streamed from the gateway, the second came from an
// IndexedDB seed written months ago, and both were styled identically. An
// operator had no way to tell which half of the screen was describing the
// robot in front of them.
//
// Every value on this page now carries its provenance (see ui/Signal.tsx).
// Gateway-derived figures read LIVE; IndexedDB-derived figures read CACHED
// with an age; anything with no source renders an em-dash instead of the
// last number it happened to remember.

// ---- HeartbeatSpark: a hand-drawn ECG-style SVG, not a charting library ---

function HeartbeatSpark({ history }: { history: number[] }) {
  const width = 132;
  const height = 24;
  const mid = height / 2;
  const samples = history.slice(-20);
  const n = Math.max(samples.length, 1);
  const segW = width / n;

  let d = `M 0 ${mid}`;
  samples.forEach((sample, i) => {
    const x0 = i * segW;
    if (sample === 1) {
      d += ` L ${x0 + segW * 0.3} ${mid + height * 0.42}`;
      d += ` L ${x0 + segW * 0.45} ${mid - height * 0.42}`;
      d += ` L ${x0 + segW * 0.6} ${mid + height * 0.24}`;
      d += ` L ${x0 + segW * 0.75} ${mid - height * 0.24}`;
    }
    d += ` L ${x0 + segW} ${mid}`;
  });

  const latest = samples[samples.length - 1];
  const stroke = latest === 1 ? "stroke-nominal" : "stroke-fault";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="hidden lg:block"
      role="img"
      aria-label={latest === 1 ? "Gateway link healthy" : "Gateway link down"}
    >
      <path
        d={d}
        fill="none"
        className={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---- Shared small pieces ------------------------------------------------

/** A compact metric tile used inside tabs. */
function Tile({
  label,
  value,
  unit,
  state = "cached",
  age,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  state?: Provenance;
  age?: number | null;
  tone?: "default" | "nominal" | "caution" | "fault";
  icon?: ReactNode;
}) {
  return (
    <div className="shadow-panel rounded-lg border border-line bg-surface p-md">
      <Readout
        label={label}
        value={value}
        unit={unit}
        state={state}
        age={age}
        tone={tone}
        size="sm"
        icon={icon}
      />
    </div>
  );
}

/** A labelled 0–100 bar. Colour is semantic: over 80 is a fault, over 60 caution. */
function Meter({ label, value, display }: { label: string; value: number; display: string }) {
  const tone = value > 80 ? "bg-fault" : value > 60 ? "bg-caution" : "bg-nominal";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-sans text-caption text-muted">{label}</span>
        <span className="font-mono text-caption text-body">{display}</span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-pill bg-elevated"
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`h-full rounded-pill transition-[width] duration-500 ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ---- Robot Info tab ------------------------------------------------

function BatteryRing({ level }: { level: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp(level, 0, 100) / 100);
  const color = level > 50 ? "stroke-nominal" : level > 20 ? "stroke-caution" : "stroke-fault";
  return (
    <svg width={52} height={52} className="-rotate-90" aria-hidden>
      <circle cx={26} cy={26} r={radius} fill="none" className="stroke-elevated" strokeWidth={4} />
      <circle
        cx={26}
        cy={26}
        r={radius}
        fill="none"
        className={`${color} transition-[stroke-dashoffset] duration-500`}
        strokeWidth={4}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function RobotInfoTab({
  robot,
  cachedAt,
  events,
}: {
  robot: Robot;
  cachedAt: number | null;
  events: EmergencyStop[];
}) {
  return (
    <div className="flex flex-col gap-lg">
      {/* These four are IndexedDB values, not gateway values, and they say so. */}
      <div className="grid grid-cols-1 gap-md min-[420px]:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Reported status"
          value={robot.status}
          state="cached"
          age={cachedAt}
          tone={robot.status === "online" ? "nominal" : robot.status === "error" ? "fault" : "default"}
          icon={<Activity className="h-3.5 w-3.5" />}
        />
        <div className="shadow-panel flex items-center gap-md rounded-lg border border-line bg-surface p-md">
          <BatteryRing level={robot.battery_level} />
          <Readout
            label="Battery"
            value={robot.battery_level}
            unit="%"
            state="cached"
            age={cachedAt}
            size="sm"
            tone={robot.battery_level < 20 ? "caution" : "default"}
          />
        </div>
        <Tile
          label="Uptime"
          value={robot.uptime_hours.toFixed(1)}
          unit="h"
          state="cached"
          age={cachedAt}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
        <Tile
          label="Address"
          value={robot.ip_address}
          state="cached"
          age={cachedAt}
          icon={<Wifi className="h-3.5 w-3.5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[1fr_380px]">
        <Panel title="Hardware specification">
          <dl>
            <KeyValue label="Name" value={robot.name} mono={false} />
            <KeyValue label="Model" value={robot.model} />
            <KeyValue label="Serial" value={robot.serial_number} />
            <KeyValue label="Firmware" value={robot.firmware_version} />
            <KeyValue label="IP address" value={robot.ip_address} />
            <KeyValue label="Last mission" value={robot.last_mission ?? "—"} mono={false} />
          </dl>
        </Panel>

        <Panel
          title="Safety events"
          action={<span className="font-mono text-[11px] text-faint">{events.length}</span>}
        >
          <EventLog
            events={events}
            limit={5}
            emptyDescription="No emergency stop has been triggered on this robot."
          />
        </Panel>
      </div>
    </div>
  );
}

// ---- Sensors tab ------------------------------------------------

function sensorIcon(name: string): LucideIcon {
  if (/lidar/i.test(name)) return Radar;
  if (/imu/i.test(name)) return Compass;
  if (/camera/i.test(name)) return Camera;
  if (/ultrasonic/i.test(name)) return Waves;
  if (/encoder/i.test(name)) return Cog;
  if (/amcl|localis/i.test(name)) return Crosshair;
  return Activity;
}

/** LIDAR/encoder cards get a live one-line readout, matched by regex against
 * the sensor's own `name` - the app has no per-sensor data contract, so this
 * is how "hardware" cards borrow from the real-time streams. */
function sensorLiveSummary(
  sensor: RobotSensor,
  scan: ScanFrame | null,
  robotState: Telemetry | null,
): string | null {
  if (/lidar/i.test(sensor.name) && scan) {
    const valid = scan.ranges.filter((r) => r !== null).length;
    return `${valid}/${scan.ranges.length} beams · frame ${scan.frame_id}`;
  }
  if (/encoder/i.test(sensor.name) && robotState) {
    return `x ${robotState.x.toFixed(2)}m  y ${robotState.y.toFixed(2)}m  θ ${robotState.theta.toFixed(2)}rad`;
  }
  return null;
}

function SensorCard({
  sensor,
  software,
  liveSummary,
}: {
  sensor: RobotSensor;
  software: boolean;
  liveSummary: string | null;
}) {
  const Icon = sensorIcon(sensor.name);
  const tempPct = sensor.temperature !== null ? clamp((sensor.temperature / 70) * 100, 0, 100) : null;
  const tone = sensor.status === "live" ? "nominal" : sensor.status === "software" ? "brand" : "caution";

  return (
    <div className="shadow-panel flex flex-col rounded-lg border border-line bg-surface p-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 flex-none text-faint" />
          <span className="truncate font-sans text-title-sm text-ink">{sensor.name}</span>
        </div>
        <Chip tone={tone}>{software ? "software" : sensor.status}</Chip>
      </div>

      <p className="font-mono text-[11px] text-faint">
        {sensor.model} · {sensor.frequency}
      </p>

      {liveSummary && (
        <p className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-nominal">
          <span className="h-1 w-1 flex-none animate-breathe rounded-pill bg-nominal" />
          {liveSummary}
        </p>
      )}

      {tempPct !== null && (
        <div className="mt-md">
          <Meter label="Temperature" value={tempPct} display={`${sensor.temperature}°C`} />
        </div>
      )}
    </div>
  );
}

function SensorsTab({
  sensors,
  scan,
  robotState,
  localisation,
  cachedAt,
}: {
  sensors: RobotSensor[];
  scan: ScanFrame | null;
  robotState: Telemetry | null;
  localisation: unknown;
  cachedAt: number | null;
}) {
  const virtualAmcl: RobotSensor = {
    id: "virt-amcl",
    robot_id: sensors[0]?.robot_id ?? "robot-default",
    name: "AMCL Localisation Engine",
    model: "amcl (Nav2)",
    status: localisation ? "live" : "software",
    frequency: "~1 Hz",
    temperature: null,
    created_at: new Date().toISOString(),
  };
  const allSensors = [...sensors, virtualAmcl];
  const activeCount = allSensors.filter((s) => s.status !== "offline").length;
  const liveFeedCount = [scan, robotState, localisation].filter(Boolean).length;
  const temps = sensors.map((s) => s.temperature).filter((t): t is number => t !== null);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const validBeams = scan ? scan.ranges.filter((r) => r !== null).length : 0;

  return (
    <div className="flex flex-col gap-lg">
      <div className="grid grid-cols-1 gap-md min-[420px]:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Modules online"
          value={`${activeCount}/${allSensors.length}`}
          state="cached"
          age={cachedAt}
          tone={activeCount < allSensors.length ? "caution" : "nominal"}
        />
        <Tile
          label="Live data feeds"
          value={liveFeedCount}
          state={liveFeedCount > 0 ? "live" : "absent"}
          tone={liveFeedCount > 0 ? "nominal" : "default"}
        />
        <Tile
          label="Avg module temp"
          value={avgTemp !== null ? avgTemp.toFixed(1) : null}
          unit="°C"
          state="cached"
          age={cachedAt}
        />
        <Tile
          label="Lidar beams"
          value={scan ? `${validBeams}/${scan.ranges.length}` : null}
          state={scan ? "live" : "absent"}
        />
      </div>

      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3">
        {allSensors.map((sensor) => (
          <SensorCard
            key={sensor.id}
            sensor={sensor}
            software={sensor.id === "virt-amcl"}
            liveSummary={sensorLiveSummary(sensor, scan, robotState)}
          />
        ))}
      </div>
    </div>
  );
}

// ---- Configuration tab ------------------------------------------------

const NUMERIC_PARAMS = [
  { key: "max_speed", label: "Max speed", min: 0, max: 3, unit: "m/s" },
  { key: "max_linear_speed", label: "Max linear speed", min: 0.1, max: 0.8, unit: "m/s" },
  { key: "max_turn_rate", label: "Max turn rate", min: 0.1, max: 1.0, unit: "rad/s" },
  { key: "obstacle_distance", label: "Obstacle distance", min: 0, max: 2, unit: "m" },
] as const;

const TEXT_PARAMS = [
  { key: "navigation_mode", label: "Navigation mode" },
  { key: "localization_method", label: "Localization method" },
  { key: "path_planner", label: "Path planner" },
  { key: "recovery_behavior", label: "Recovery behavior" },
] as const;

type ConfigKey = (typeof NUMERIC_PARAMS)[number]["key"] | (typeof TEXT_PARAMS)[number]["key"];

interface EditControls {
  editingKey: string | null;
  editValue: string;
  onStartEdit: (key: ConfigKey, current: string) => void;
  onChangeValue: (v: string) => void;
  onSave: (key: ConfigKey) => void;
  onCancel: () => void;
}

function EditRow({
  label,
  editing,
  editValue,
  onChangeValue,
  onSave,
  onCancel,
  children,
}: {
  label: string;
  editing: boolean;
  editValue: string;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/param border-b border-line-soft py-sm last:border-0">
      <div className="flex min-h-[28px] items-center justify-between gap-md">
        <span className="font-sans text-body-sm text-muted">{label}</span>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={editValue}
              onChange={(e) => onChangeValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancel();
              }}
              aria-label={`New value for ${label}`}
              className={`${inputClass} h-8 w-32 border-coral font-mono`}
            />
            <button
              onClick={onSave}
              aria-label={`Save ${label}`}
              className="text-nominal transition-colors hover:text-ink"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={onCancel}
              aria-label={`Cancel editing ${label}`}
              className="text-faint transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function NumericParamRow({
  label,
  paramKey,
  value,
  min,
  max,
  unit,
  controls,
}: {
  label: string;
  paramKey: ConfigKey;
  value: number;
  min: number;
  max: number;
  unit: string;
  controls: EditControls;
}) {
  const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
  const editing = controls.editingKey === paramKey;
  return (
    <EditRow
      label={label}
      editing={editing}
      editValue={controls.editValue}
      onChangeValue={controls.onChangeValue}
      onSave={() => controls.onSave(paramKey)}
      onCancel={controls.onCancel}
    >
      <div className="flex items-center gap-md">
        {/* The bar sits inline with the value rather than on its own row, so
            the rows stay a fixed height and the column reads as a table. */}
        <div className="hidden h-1 w-24 overflow-hidden rounded-pill bg-elevated sm:block">
          <div className="h-full rounded-pill bg-coral" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-body-sm text-ink">
          {value} <span className="text-faint">{unit}</span>
        </span>
        <button
          onClick={() => controls.onStartEdit(paramKey, String(value))}
          aria-label={`Edit ${label}`}
          className="text-faint opacity-0 transition-opacity hover:text-coral focus-visible:opacity-100 group-hover/param:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </EditRow>
  );
}

function TextParamRow({
  label,
  paramKey,
  value,
  controls,
}: {
  label: string;
  paramKey: ConfigKey;
  value: string;
  controls: EditControls;
}) {
  return (
    <EditRow
      label={label}
      editing={controls.editingKey === paramKey}
      editValue={controls.editValue}
      onChangeValue={controls.onChangeValue}
      onSave={() => controls.onSave(paramKey)}
      onCancel={controls.onCancel}
    >
      <div className="flex items-center gap-md">
        <span className="font-mono text-body-sm text-ink">{value}</span>
        <button
          onClick={() => controls.onStartEdit(paramKey, value)}
          aria-label={`Edit ${label}`}
          className="text-faint opacity-0 transition-opacity hover:text-coral focus-visible:opacity-100 group-hover/param:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </EditRow>
  );
}

function ConfigurationTab({ robot, controls }: { robot: Robot; controls: EditControls }) {
  return (
    <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
      <Panel
        title="Motion & safety limits"
        action={<Chip tone="caution">Affects driving</Chip>}
      >
        {NUMERIC_PARAMS.map((p) => (
          <NumericParamRow
            key={p.key}
            label={p.label}
            paramKey={p.key}
            value={robot[p.key]}
            min={p.min}
            max={p.max}
            unit={p.unit}
            controls={controls}
          />
        ))}
      </Panel>
      <Panel title="Navigation stack">
        {TEXT_PARAMS.map((p) => (
          <TextParamRow
            key={p.key}
            label={p.label}
            paramKey={p.key}
            value={robot[p.key]}
            controls={controls}
          />
        ))}
      </Panel>
    </div>
  );
}

// ---- System tab ------------------------------------------------

const TOPICS = [
  { name: "/global_costmap/costmap", thresholdS: 5 },
  { name: "/scan", thresholdS: 5 },
  { name: "/amcl_pose", thresholdS: 9999 }, // AMCL only publishes on motion - never call it stale
  { name: "/plan", thresholdS: 15 },
] as const;

function TopicRow({ name, thresholdS, ageS }: { name: string; thresholdS: number; ageS: number | null }) {
  const state: Provenance = ageS === null ? "absent" : ageS < thresholdS ? "live" : "stale";
  return (
    <div className="flex items-center justify-between gap-md border-b border-line-soft py-2 last:border-0">
      <span className="truncate font-mono text-body-sm text-body">{name}</span>
      <SignalTag state={state} label={ageS !== null ? `${ageS.toFixed(1)}S AGO` : "SILENT"} />
    </div>
  );
}

/** NOT measuring anything real - a static seed jittered randomly every
 * 2.5s, purely for visual liveliness. Carried over from the build brief as-
 * is (labeled "simulated" in the UI, not silently passed off as real) -
 * wire real host metrics here during a later migration if it's worth it. */
function Gauge({ label, seed }: { label: string; seed: number }) {
  const [value, setValue] = useState(seed);
  useEffect(() => {
    const interval = window.setInterval(() => {
      setValue((v) => clamp(v + (Math.random() - 0.5) * 10, 5, 95));
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);
  return <Meter label={label} value={value} display={`${value.toFixed(0)}%`} />;
}

const ENVIRONMENT_DETAILS: Array<[string, string]> = [
  ["OS", "Ubuntu 22.04 LTS"],
  ["Middleware", "ROS 2 Humble Hawksbill"],
  ["DDS", "Fast DDS (default RMW)"],
  ["SoC", "ARM Cortex-A78AE (simulated)"],
  ["Memory", "8 GB LPDDR5"],
  ["Kernel", "Linux 5.15 (aarch64)"],
  ["Accelerator", "None (CPU-only inference)"],
];

function SystemTab({ health }: { health: GatewayHealth }) {
  return (
    <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
      <Panel
        title="ROS 2 runtime"
        action={<SignalTag state={health.ok ? "live" : "absent"} age={health.lastOkAt} />}
      >
        <div className="mb-lg">
          {TOPICS.map((t) => (
            <TopicRow
              key={t.name}
              name={t.name}
              thresholdS={t.thresholdS}
              ageS={health.topics[t.name] ?? null}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-md">
          <Tile
            label="Gateway RTT"
            value={health.latencyMs !== null ? Math.round(health.latencyMs) : null}
            unit="ms"
            state={health.ok ? "live" : "absent"}
          />
          <Tile
            label="Health polls"
            value={health.history.length}
            state={health.probed ? "live" : "absent"}
          />
        </div>
      </Panel>

      <div className="flex flex-col gap-lg">
        <Panel
          title="Compute resources"
          action={<Chip tone="caution">Simulated</Chip>}
        >
          <div className="flex flex-col gap-md">
            <Gauge label="CPU" seed={62} />
            <Gauge label="Memory" seed={45} />
            <Gauge label="vRAM" seed={34} />
            <Gauge label="NVMe" seed={28} />
          </div>
        </Panel>

        <Panel title="Environment">
          <dl>
            {ENVIRONMENT_DETAILS.map(([k, v]) => (
              <KeyValue key={k} label={k} value={v} />
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

// ---- Page ------------------------------------------------

const TABS = ["Robot", "Sensors", "Configuration", "System"] as const;
type TabName = (typeof TABS)[number];

export function DashboardPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabName>("Robot");
  const [robot, setRobot] = useState<Robot | null>(null);
  const [sensors, setSensors] = useState<RobotSensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const health = useGatewayHealth(3000);
  const { history: estopHistory } = useEmergencyStop();
  const { scan } = useScan(true); // always-on here - only used for a beam-count stat, not a rendered HUD
  const { telemetry } = useTelemetry();
  const { localisation } = useLocalisation();
  const { plan } = usePlan();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await localDb.getRobot();
        if (cancelled) return;
        setRobot(r);
        const s = await localDb.getSensors(r.id);
        if (cancelled) return;
        setSensors(s);
      } catch {
        if (!cancelled) setError("Failed to load robot data from local storage.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onStartEdit = useCallback((key: ConfigKey, current: string) => {
    setEditingKey(key);
    setEditValue(current);
  }, []);

  const onCancel = useCallback(() => {
    setEditingKey(null);
    setEditValue("");
  }, []);

  const saveField = useCallback(
    async (key: ConfigKey) => {
      if (!robot) return;
      const isNumeric = NUMERIC_PARAMS.some((p) => p.key === key);
      let value: string | number = editValue;

      if (isNumeric) {
        const parsed = parseFloat(editValue);
        if (Number.isNaN(parsed)) {
          toast.show("error", `${key} must be a number.`);
          return;
        }
        if (key === "max_linear_speed" && (parsed < 0.1 || parsed > 0.8)) {
          toast.show("error", "Max Linear Speed must be between 0.1 and 0.8 m/s.");
          return;
        }
        if (key === "max_turn_rate" && (parsed < 0.1 || parsed > 1.0)) {
          toast.show("error", "Max Turn Rate must be between 0.1 and 1.0 rad/s.");
          return;
        }
        value = parsed;
      }

      try {
        const updated = await localDb.updateRobot(robot.id, { [key]: value });
        setRobot(updated);
        toast.show("success", "Configuration updated.");
        setEditingKey(null);
        setEditValue("");
      } catch {
        toast.show("error", "Failed to save configuration.");
      }
    },
    [robot, editValue, toast],
  );

  const controls: EditControls = {
    editingKey,
    editValue,
    onStartEdit,
    onChangeValue: setEditValue,
    onSave: saveField,
    onCancel,
  };

  const missionActive = !!(plan && plan.points.length > 0);
  const cachedAt = robot ? Date.parse(robot.updated_at) : null;

  return (
    <AppShell title="Dashboard" toolbar={<HeartbeatSpark history={health.history} />}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-lg">
        {/* ---- Live strip. Everything here streams from the gateway; the
                tab content below is explicitly labelled by its own source. */}
        <div className="shadow-panel grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          <div className="bg-surface px-md py-sm">
            <Readout
              label="Robot"
              value={health.robotAlive ? "alive" : null}
              state={health.robotAlive ? "live" : "absent"}
              tone={health.robotAlive ? "nominal" : "default"}
              size="sm"
            />
          </div>
          <div className="bg-surface px-md py-sm">
            <Readout
              label="Gateway"
              value={health.latencyMs !== null ? Math.round(health.latencyMs) : null}
              unit="ms"
              state={health.ok ? "live" : "absent"}
              age={health.lastOkAt}
              tone={health.latencyMs !== null && health.latencyMs > 100 ? "caution" : "nominal"}
              size="sm"
            />
          </div>
          <div className="bg-surface px-md py-sm">
            <Readout
              label="Pose"
              value={localisation ? `${localisation.x.toFixed(2)}, ${localisation.y.toFixed(2)}` : null}
              state={localisation ? "live" : "absent"}
              size="sm"
            />
          </div>
          <div className="bg-surface px-md py-sm">
            <Readout
              label="Mission"
              value={missionActive ? `${plan!.points.length} pts` : null}
              state={missionActive ? "live" : "absent"}
              tone={missionActive ? "nominal" : "default"}
              size="sm"
            />
          </div>
        </div>

        {/* ---- Tabs. DESIGN.md category-tab / category-tab-active. */}
        <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((tab) => {
            const selected = activeTab === tab;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab)}
                className={[
                  "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 font-sans text-nav transition-colors",
                  selected
                    ? "border-coral text-ink"
                    : "border-transparent text-muted hover:border-line hover:text-body",
                ].join(" ")}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="grid grid-cols-1 gap-md min-[420px]:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}

        {!loading && error && (
          <EmptyState
            icon={<X className="h-7 w-7" />}
            title="Could not load robot data"
            description={error}
          />
        )}

        {!loading && !error && robot && (
          <div key={activeTab} className="animate-fade-in">
            {activeTab === "Robot" && (
              <RobotInfoTab robot={robot} cachedAt={cachedAt} events={estopHistory} />
            )}
            {activeTab === "Sensors" && (
              <SensorsTab
                sensors={sensors}
                scan={scan}
                robotState={telemetry}
                localisation={localisation}
                cachedAt={cachedAt}
              />
            )}
            {activeTab === "Configuration" && <ConfigurationTab robot={robot} controls={controls} />}
            {activeTab === "System" && <SystemTab health={health} />}
          </div>
        )}
      </div>
    </AppShell>
  );
}
