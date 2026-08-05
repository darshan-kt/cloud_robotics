// The app-data repository. Every page imports THIS, never lib/idb.ts
// directly - that's what makes this the migration seam described in
// README.md: swap a function body from an idb call to a fetch() call and
// every caller stays untouched, because the signatures don't change.
//
// Storage shape: each collection is one array value under one key (not one
// IDB record per item) - simple, and plenty for this data volume.
import { get, put } from "./idb";
import type {
  Robot,
  RobotSensor,
  EmergencyStop,
  MapData,
  SafetyZone,
  Mission,
  ScheduledRoute,
  ScheduleExecution,
  Conversation,
} from "../types";

const LOCAL_USER_ID = "local-user";

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Robot -----------------------------------------------------------

const DEFAULT_ROBOT: Robot = {
  id: "robot-default",
  user_id: LOCAL_USER_ID,
  name: "AMR-X200",
  model: "AMR-X200",
  serial_number: "SN-2024-0847",
  firmware_version: "2.4.1",
  ip_address: "192.168.1.42",
  status: "online",
  battery_level: 78,
  uptime_hours: 132.5,
  last_mission: "Warehouse Loop A",
  max_speed: 1.2,
  max_linear_speed: 0.5,
  max_turn_rate: 0.6,
  obstacle_distance: 0.4,
  navigation_mode: "autonomous",
  localization_method: "AMCL",
  path_planner: "NavFn",
  recovery_behavior: "spin_and_backup",
  created_at: nowIso(),
  updated_at: nowIso(),
};

export async function getRobot(): Promise<Robot> {
  const existing = await get<Robot>("robots", "current");
  if (existing) return existing;
  await put("robots", "current", DEFAULT_ROBOT);
  return DEFAULT_ROBOT;
}

export async function updateRobot(
  _id: string,
  updates: Partial<Robot>,
): Promise<Robot> {
  const current = await getRobot();
  const updated: Robot = { ...current, ...updates, updated_at: nowIso() };
  await put("robots", "current", updated);
  return updated;
}

// ---- Sensors -----------------------------------------------------------

function defaultSensors(robotId: string): RobotSensor[] {
  const spec: Array<Pick<RobotSensor, "name" | "model" | "status" | "frequency" | "temperature">> = [
    { name: "LiDAR", model: "LDS-01", status: "live", frequency: "5 Hz", temperature: 38 },
    { name: "IMU", model: "BNO055", status: "live", frequency: "100 Hz", temperature: 34 },
    { name: "Front Camera", model: "RealSense D435", status: "live", frequency: "30 Hz", temperature: 42 },
    { name: "Rear Camera", model: "RealSense D435", status: "software", frequency: "30 Hz", temperature: null },
    { name: "Ultrasonic Array", model: "HC-SR04 x4", status: "live", frequency: "10 Hz", temperature: null },
    { name: "Wheel Encoder", model: "Quadrature x2", status: "live", frequency: "50 Hz", temperature: null },
  ];
  return spec.map((s, i) => ({
    id: `sensor-${i}`,
    robot_id: robotId,
    created_at: nowIso(),
    ...s,
  }));
}

export async function getSensors(robotId: string): Promise<RobotSensor[]> {
  const existing = await get<RobotSensor[]>("sensors", robotId);
  if (existing) return existing;
  const seeded = defaultSensors(robotId);
  await put("sensors", robotId, seeded);
  return seeded;
}

// ---- Emergency stops -----------------------------------------------------

const ESTOP_UPDATED_EVENT = "localdb-estop-updated";

export async function getEmergencyStops(limit = 10): Promise<EmergencyStop[]> {
  const all = (await get<EmergencyStop[]>("emergency_stops", "all")) ?? [];
  return [...all]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export async function triggerEmergencyStop(
  robotId: string,
  isActive: boolean,
  reason: string,
): Promise<EmergencyStop> {
  const all = (await get<EmergencyStop[]>("emergency_stops", "all")) ?? [];
  const entry: EmergencyStop = {
    id: newId("estop"),
    robot_id: robotId,
    user_id: LOCAL_USER_ID,
    is_active: isActive,
    triggered_at: isActive ? nowIso() : null,
    released_at: isActive ? null : nowIso(),
    triggered_by: "operator",
    reason,
    created_at: nowIso(),
  };
  await put("emergency_stops", "all", [...all, entry]);

  // Header's E-Stop badge (and anyone else listening) picks this up same-
  // tick, no polling loop or lifted context needed for something this
  // infrequent. See README.md.
  window.dispatchEvent(new CustomEvent(ESTOP_UPDATED_EVENT, { detail: entry }));

  return entry;
}

export function onEmergencyStopUpdated(handler: (entry: EmergencyStop) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<EmergencyStop>).detail);
  window.addEventListener(ESTOP_UPDATED_EVENT, listener);
  return () => window.removeEventListener(ESTOP_UPDATED_EVENT, listener);
}

// ---- Maps -----------------------------------------------------------

export async function getMaps(): Promise<MapData[]> {
  return (await get<MapData[]>("maps", "all")) ?? [];
}

export async function saveMap(data: Partial<MapData>): Promise<MapData> {
  const all = await getMaps();
  const id = data.id ?? newId("map");
  const existingIndex = all.findIndex((m) => m.id === id);
  const base: MapData =
    existingIndex >= 0
      ? all[existingIndex]
      : {
          id,
          user_id: LOCAL_USER_ID,
          name: "Untitled map",
          description: "",
          status: "ready",
          source: "upload",
          resolution: 0.05,
          width: 0,
          height: 0,
          map_data: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
  const merged: MapData = { ...base, ...data, id, updated_at: nowIso() };
  const next = existingIndex >= 0 ? all.map((m, i) => (i === existingIndex ? merged : m)) : [...all, merged];
  await put("maps", "all", next);
  return merged;
}

// ---- Safety zones -----------------------------------------------------------

export async function getSafetyZones(mapId: string): Promise<SafetyZone[]> {
  const all = (await get<SafetyZone[]>("safety_zones", "all")) ?? [];
  return all.filter((z) => z.map_id === mapId);
}

export async function saveSafetyZone(data: Partial<SafetyZone>): Promise<SafetyZone> {
  const all = (await get<SafetyZone[]>("safety_zones", "all")) ?? [];
  const id = data.id ?? newId("zone");
  const existingIndex = all.findIndex((z) => z.id === id);
  const base: SafetyZone =
    existingIndex >= 0
      ? all[existingIndex]
      : {
          id,
          map_id: data.map_id ?? "",
          name: "Untitled zone",
          zone_type: "keepout",
          vertices: [],
          color: "#ff4d6a",
          created_at: nowIso(),
        };
  const merged: SafetyZone = { ...base, ...data, id };
  const next = existingIndex >= 0 ? all.map((z, i) => (i === existingIndex ? merged : z)) : [...all, merged];
  await put("safety_zones", "all", next);
  return merged;
}

export async function deleteSafetyZone(id: string): Promise<void> {
  const all = (await get<SafetyZone[]>("safety_zones", "all")) ?? [];
  await put("safety_zones", "all", all.filter((z) => z.id !== id));
}

// ---- Missions -----------------------------------------------------------

export async function getMissions(): Promise<Mission[]> {
  return (await get<Mission[]>("missions", "all")) ?? [];
}

export async function saveMission(data: Partial<Mission>): Promise<Mission> {
  const all = await getMissions();
  const id = data.id ?? newId("mission");
  const existingIndex = all.findIndex((m) => m.id === id);
  const base: Mission =
    existingIndex >= 0
      ? all[existingIndex]
      : {
          id,
          user_id: LOCAL_USER_ID,
          map_id: data.map_id ?? "",
          name: "Untitled mission",
          status: "pending",
          waypoints: [],
          created_at: nowIso(),
          updated_at: nowIso(),
        };
  const merged: Mission = { ...base, ...data, id, updated_at: nowIso() };
  const next = existingIndex >= 0 ? all.map((m, i) => (i === existingIndex ? merged : m)) : [...all, merged];
  await put("missions", "all", next);
  return merged;
}

export async function updateMissionStatus(id: string, status: string): Promise<Mission | null> {
  const all = await getMissions();
  const existing = all.find((m) => m.id === id);
  if (!existing) return null;
  return saveMission({ ...existing, status });
}

// ---- Schedules -----------------------------------------------------------

export async function getSchedules(): Promise<ScheduledRoute[]> {
  return (await get<ScheduledRoute[]>("schedules", "all")) ?? [];
}

export async function saveSchedule(data: Partial<ScheduledRoute>): Promise<ScheduledRoute> {
  const all = await getSchedules();
  const id = data.id ?? newId("schedule");
  const existingIndex = all.findIndex((s) => s.id === id);
  const base: ScheduledRoute =
    existingIndex >= 0
      ? all[existingIndex]
      : {
          id,
          user_id: LOCAL_USER_ID,
          map_id: data.map_id ?? "",
          name: "Untitled schedule",
          description: "",
          waypoints: [],
          schedule_type: "once",
          schedule_date: null,
          schedule_time: null,
          recurrence_days: [],
          is_active: true,
          priority: 1,
          estimated_duration: 0,
          color: "#38bdf8",
          created_at: nowIso(),
          updated_at: nowIso(),
        };
  const merged: ScheduledRoute = { ...base, ...data, id, updated_at: nowIso() };
  const next = existingIndex >= 0 ? all.map((s, i) => (i === existingIndex ? merged : s)) : [...all, merged];
  await put("schedules", "all", next);
  return merged;
}

export async function deleteSchedule(id: string): Promise<void> {
  const all = await getSchedules();
  await put("schedules", "all", all.filter((s) => s.id !== id));
}

// ---- Executions -----------------------------------------------------------

export async function getExecutions(): Promise<ScheduleExecution[]> {
  return (await get<ScheduleExecution[]>("executions", "all")) ?? [];
}

export async function saveExecution(data: Partial<ScheduleExecution>): Promise<ScheduleExecution> {
  const all = await getExecutions();
  const id = data.id ?? newId("exec");
  const existingIndex = all.findIndex((e) => e.id === id);
  const base: ScheduleExecution =
    existingIndex >= 0
      ? all[existingIndex]
      : {
          id,
          scheduled_route_id: data.scheduled_route_id ?? "",
          user_id: LOCAL_USER_ID,
          mission_id: null,
          scheduled_for: nowIso(),
          status: "pending",
          started_at: null,
          completed_at: null,
          duration_seconds: null,
          error_message: null,
          waypoints_completed: 0,
          waypoints_total: 0,
          trigger_source: "manual",
          created_at: nowIso(),
        };
  const merged: ScheduleExecution = { ...base, ...data, id };
  const next = existingIndex >= 0 ? all.map((e, i) => (i === existingIndex ? merged : e)) : [...all, merged];
  await put("executions", "all", next);
  return merged;
}

// ---- Conversations -----------------------------------------------------------

export async function getConversation(userId: string): Promise<Conversation | null> {
  return (await get<Conversation>("conversations", userId)) ?? null;
}

export async function saveConversation(data: Partial<Conversation>): Promise<Conversation> {
  const userId = data.user_id ?? LOCAL_USER_ID;
  const existing = await getConversation(userId);
  const merged: Conversation = {
    id: existing?.id ?? newId("conv"),
    user_id: userId,
    robot_id: data.robot_id ?? existing?.robot_id ?? "robot-default",
    mode: data.mode ?? existing?.mode ?? "chat",
    messages: data.messages ?? existing?.messages ?? [],
    updated_at: nowIso(),
  };
  await put("conversations", userId, merged);
  return merged;
}

// ---- Legacy localStorage migration -----------------------------------------------------------

/** One-time guard: ports any pre-existing `localStorage` keys prefixed
 * `robot_store_*` into IndexedDB, then sets a meta flag so it never runs
 * again. Safe to drop entirely in a project with no legacy users - kept here
 * only because it's cheap insurance and matches the source app's behavior. */
export async function migrateLegacyData(): Promise<void> {
  const migrated = await get<boolean>("meta", "migrated");
  if (migrated) return;

  const prefix = "robot_store_";
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const collection = key.slice(prefix.length) as Parameters<typeof put>[0];
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      await put(collection, "all", value);
    } catch {
      // Malformed legacy value - skip it rather than fail the whole migration.
    }
  }

  await put("meta", "migrated", true);
}
