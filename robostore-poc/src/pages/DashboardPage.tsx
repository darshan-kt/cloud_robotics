import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Battery,
  Camera,
  Clock,
  Cog,
  Compass,
  LayoutDashboard,
  Check,
  Crosshair,
  Pencil,
  Radar,
  Waves,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { Header } from "../components/layout/Header";
import { Card, Badge, Skeleton } from "../components/ui/Layout";
import { useToast } from "../components/ui/Toast";
import { GATEWAY_URL } from "../lib/config";
import { clamp } from "../lib/utils";
import * as localDb from "../lib/localDb";
import type { Robot, RobotSensor } from "../types";
import { useScan, type ScanFrame } from "../hooks/useScan";
import { useTelemetry, type Telemetry } from "../hooks/useTelemetry";
import { useLocalisation } from "../hooks/useLocalisation";
import { usePlan } from "../hooks/usePlan";

// ---- Page-local hook: useGatewayHealth --------------------------------
// Deliberately NOT shared with other pages (unlike useTelemetry etc.) - it's
// the only place in the app that measures its own round-trip latency
// (performance.now() before/after the fetch, since the gateway's /health
// response carries no timestamp of its own) and keeps a rolling history for
// the heartbeat sparkline. See the build brief's Dashboard step.

interface GatewayHealth {
  ok: boolean;
  robotAlive: boolean;
  latencyMs: number | null;
  topics: Record<string, number>;
  history: number[]; // 1 = poll succeeded, 0 = failed - last 40 kept
}

function useGatewayHealth(intervalMs = 3000): GatewayHealth {
  const [state, setState] = useState<GatewayHealth>({
    ok: false,
    robotAlive: false,
    latencyMs: null,
    topics: {},
    history: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const start = performance.now();
      try {
        const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const elapsed = performance.now() - start;
        if (cancelled) return;
        setState((s) => ({
          ok: true,
          robotAlive: !!body.robot_alive,
          latencyMs: elapsed,
          topics: body.topics ?? {},
          history: [...s.history, 1].slice(-40),
        }));
      } catch {
        if (cancelled) return;
        setState((s) => ({
          ok: false,
          robotAlive: false,
          latencyMs: null,
          topics: {},
          history: [...s.history, 0].slice(-40),
        }));
      }
    }

    poll();
    const interval = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  return state;
}

// ---- HeartbeatSpark: a hand-drawn ECG-style SVG, not a charting library ---

function HeartbeatSpark({ history }: { history: number[] }) {
  const width = 160;
  const height = 28;
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
  const stroke = latest === 1 ? "#34d399" : "#f43f5e";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="hidden lg:block">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---- LiveStat: one dot+label+value in the status strip ---------------

type Tone = "emerald" | "amber" | "rose" | "blue" | "muted";

const TONE_DOT: Record<Tone, string> = {
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  blue: "bg-blue-400",
  muted: "bg-textDim",
};

function LiveStat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} animate-pulse-status`} />
      <span className="font-mono text-[10px] uppercase tracking-wide text-textDim">{label}</span>
      <span className="font-mono text-xs text-text">{value}</span>
    </div>
  );
}

// ---- Shared small pieces ------------------------------------------------

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 pb-2 last:border-b-0 last:pb-0">
      <dt className="font-mono text-xs text-textDim">{label}</dt>
      <dd className="font-mono text-xs text-text">{value}</dd>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-textDim">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-text">{value}</p>
    </Card>
  );
}

// ---- Robot Info tab ------------------------------------------------

function BatteryRing({ level }: { level: number }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamp(level, 0, 100) / 100);
  const color = level > 50 ? "#34d399" : level > 20 ? "#ffb020" : "#ff4d6a";
  return (
    <svg width={60} height={60} className="-rotate-90">
      <circle cx={30} cy={30} r={radius} fill="none" stroke="#2b4d58" strokeWidth={6} />
      <circle
        cx={30}
        cy={30}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  ring,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  ring?: number;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      {ring !== undefined ? (
        <BatteryRing level={ring} />
      ) : (
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/5">
          <Icon className="h-5 w-5 text-text" />
        </div>
      )}
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-wide text-textDim">{label}</p>
        <p className="truncate font-mono text-sm font-semibold text-text">{value}</p>
      </div>
    </Card>
  );
}

function RobotInfoTab({ robot }: { robot: Robot }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard icon={Activity} label="Status" value={robot.status.toUpperCase()} />
        <MetricCard icon={Battery} label="Battery" value={`${robot.battery_level}%`} ring={robot.battery_level} />
        <MetricCard icon={Clock} label="Uptime" value={`${robot.uptime_hours.toFixed(1)}h`} />
        <MetricCard icon={Wifi} label="Comm" value={robot.ip_address} />
      </div>
      <Card className="p-5">
        <h3 className="mb-4 font-mono text-xs uppercase tracking-wide text-textMuted">Hardware Specification</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SpecRow label="Name" value={robot.name} />
          <SpecRow label="Model" value={robot.model} />
          <SpecRow label="Serial" value={robot.serial_number} />
          <SpecRow label="Firmware" value={robot.firmware_version} />
          <SpecRow label="IP Address" value={robot.ip_address} />
          <SpecRow label="Last Mission" value={robot.last_mission ?? "—"} />
        </dl>
      </Card>
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
function sensorLiveSummary(sensor: RobotSensor, scan: ScanFrame | null, robotState: Telemetry | null): string | null {
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
  const tempColor =
    sensor.temperature === null
      ? ""
      : sensor.temperature >= 50
        ? "bg-rose-500"
        : sensor.temperature >= 40
          ? "bg-amber-500"
          : "bg-emerald-500";
  const badgeTheme = sensor.status === "live" ? "emerald" : sensor.status === "software" ? "blue" : "muted";

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent" />
          <span className="font-mono text-sm text-text">{sensor.name}</span>
        </div>
        <Badge theme={badgeTheme}>{software ? "software" : sensor.status}</Badge>
      </div>
      <p className="mb-1 font-mono text-[11px] text-textDim">
        {sensor.model} · {sensor.frequency}
      </p>
      {liveSummary && <p className="mb-2 font-mono text-[11px] text-accent">{liveSummary}</p>}
      {tempPct !== null && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between font-mono text-[10px] text-textDim">
            <span>TEMP</span>
            <span>{sensor.temperature}°C</span>
          </div>
          <div className="h-1.5 rounded-full bg-card">
            <div className={`h-1.5 rounded-full ${tempColor}`} style={{ width: `${tempPct}%` }} />
          </div>
        </div>
      )}
    </Card>
  );
}

function SensorsTab({
  sensors,
  scan,
  robotState,
  localisation,
}: {
  sensors: RobotSensor[];
  scan: ScanFrame | null;
  robotState: Telemetry | null;
  localisation: unknown;
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
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile label="Modules Online" value={`${activeCount}/${allSensors.length}`} />
        <SummaryTile label="Live Data Feeds" value={String(liveFeedCount)} />
        <SummaryTile label="Avg Module Temp" value={avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : "—"} />
        <SummaryTile label="LIDAR Beams" value={scan ? `${validBeams}/${scan.ranges.length}` : "—"} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
  { key: "max_speed", label: "Max Speed", min: 0, max: 3, unit: "m/s" },
  { key: "max_linear_speed", label: "Max Linear Speed", min: 0.1, max: 0.8, unit: "m/s" },
  { key: "max_turn_rate", label: "Max Turn Rate", min: 0.1, max: 1.0, unit: "rad/s" },
  { key: "obstacle_distance", label: "Obstacle Distance", min: 0, max: 2, unit: "m" },
] as const;

const TEXT_PARAMS = [
  { key: "navigation_mode", label: "Navigation Mode" },
  { key: "localization_method", label: "Localization Method" },
  { key: "path_planner", label: "Path Planner" },
  { key: "recovery_behavior", label: "Recovery Behavior" },
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

function EditRow({ label, editing, editValue, onChangeValue, onSave, onCancel, children }: {
  label: string;
  editing: boolean;
  editValue: string;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group/param">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs text-textMuted">{label}</span>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={editValue}
              onChange={(e) => onChangeValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancel();
              }}
              className="w-24 rounded border border-accent bg-background px-1.5 py-0.5 font-mono text-xs text-text focus:outline-none"
            />
            <button onClick={onSave} aria-label={`Save ${label}`} className="text-emerald-400 hover:text-emerald-300">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={onCancel} aria-label={`Cancel editing ${label}`} className="text-textDim hover:text-text">
              <X className="h-3.5 w-3.5" />
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
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-xs text-text">
          {value} {unit}
        </span>
        <button
          onClick={() => controls.onStartEdit(paramKey, String(value))}
          aria-label={`Edit ${label}`}
          className="text-textDim opacity-0 transition-opacity hover:text-accent group-hover/param:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {!editing && (
        <div className="mt-1 h-1.5 rounded-full bg-card">
          <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
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
      <div className="flex items-center gap-1.5">
        <Badge theme="blue">{value}</Badge>
        <button
          onClick={() => controls.onStartEdit(paramKey, value)}
          aria-label={`Edit ${label}`}
          className="text-textDim opacity-0 transition-opacity hover:text-accent group-hover/param:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    </EditRow>
  );
}

function ConfigurationTab({ robot, controls }: { robot: Robot; controls: EditControls }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">Motion &amp; Safety Limits</h3>
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
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">Navigation Stack</h3>
        {TEXT_PARAMS.map((p) => (
          <TextParamRow key={p.key} label={p.label} paramKey={p.key} value={robot[p.key]} controls={controls} />
        ))}
      </Card>
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
  const fresh = ageS !== null && ageS < thresholdS;
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${fresh ? "animate-pulse-status bg-emerald-400" : "bg-amber-400"}`} />
        <span className="font-mono text-xs text-text">{name}</span>
      </div>
      <span className="font-mono text-[11px] text-textDim">{ageS !== null ? `${ageS.toFixed(1)}s ago` : "SILENT"}</span>
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
  const color = value > 80 ? "#ff4d6a" : value > 60 ? "#ffb020" : "#00e5a0";
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[10px] text-textDim">
        <span>{label}</span>
        <span>{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-card">
        <div className="h-1.5 rounded-full transition-[width]" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-textMuted">ROS 2 Runtime — Live</h3>
        <div className="mb-4">
          {TOPICS.map((t) => (
            <TopicRow key={t.name} name={t.name} thresholdS={t.thresholdS} ageS={health.topics[t.name] ?? null} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SummaryTile label="Gateway RTT" value={health.latencyMs !== null ? `${Math.round(health.latencyMs)}ms` : "—"} />
          <SummaryTile label="Health Polls" value={String(health.history.length)} />
        </div>
      </Card>
      <div className="space-y-5">
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">Compute Resources</h3>
            <span className="font-mono text-[10px] text-textDim">simulated</span>
          </div>
          <Gauge label="CPU" seed={62} />
          <Gauge label="Memory" seed={45} />
          <Gauge label="vRAM" seed={34} />
          <Gauge label="NVMe" seed={28} />
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-textMuted">Environment Details</h3>
          <dl className="space-y-2">
            {ENVIRONMENT_DETAILS.map(([k, v]) => (
              <SpecRow key={k} label={k} value={v} />
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

// ---- Page ------------------------------------------------

const TABS = ["Robot Info", "Sensors", "Configuration", "System"] as const;
type TabName = (typeof TABS)[number];

export function DashboardPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabName>("Robot Info");
  const [robot, setRobot] = useState<Robot | null>(null);
  const [sensors, setSensors] = useState<RobotSensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const health = useGatewayHealth(3000);
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

  return (
    <div className="min-h-screen">
      <Header showBack title="Dashboard" icon={LayoutDashboard} iconColor="text-emerald-400" />

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/50 bg-surface/60 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-5">
            <LiveStat label="ROBOT" value={health.robotAlive ? "ALIVE" : "OFFLINE"} tone={health.robotAlive ? "emerald" : "rose"} />
            <LiveStat
              label="GATEWAY"
              value={health.latencyMs !== null ? `${Math.round(health.latencyMs)}ms` : "DOWN"}
              tone={health.latencyMs === null ? "rose" : health.latencyMs < 100 ? "emerald" : "amber"}
            />
            <LiveStat
              label="POSE"
              value={localisation ? `${localisation.x.toFixed(2)}, ${localisation.y.toFixed(2)}` : "—"}
              tone={localisation ? "blue" : "muted"}
            />
            <LiveStat label="MISSION" value={missionActive ? `ACTIVE · ${plan!.points.length} pts` : "IDLE"} tone={missionActive ? "emerald" : "muted"} />
          </div>
          <HeartbeatSpark history={health.history} />
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-border/50 bg-surface/60 p-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 font-mono text-xs transition-colors ${
                activeTab === tab ? "bg-accent text-background" : "text-textMuted hover:bg-card hover:text-text"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}

        {!loading && error && <p className="text-sm text-danger">{error}</p>}

        {!loading && !error && robot && (
          <>
            {activeTab === "Robot Info" && <RobotInfoTab robot={robot} />}
            {activeTab === "Sensors" && (
              <SensorsTab sensors={sensors} scan={scan} robotState={telemetry} localisation={localisation} />
            )}
            {activeTab === "Configuration" && <ConfigurationTab robot={robot} controls={controls} />}
            {activeTab === "System" && <SystemTab health={health} />}
          </>
        )}
      </main>
    </div>
  );
}
