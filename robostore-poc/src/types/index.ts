// Data model shared across ROBOSTORE's apps. Field names here are the
// contract the rest of the app relies on — see lib/localDb.ts (app data,
// IndexedDB-backed today) and README.md §"Two data layers" for which of
// these are local-only vs. destined to come from the real robot-agent.

export interface Robot {
  id: string;
  user_id: string;
  name: string;
  model: string;
  serial_number: string;
  firmware_version: string;
  ip_address: string;
  status: "online" | "offline" | "error";
  battery_level: number;
  uptime_hours: number;
  last_mission: string | null;
  max_speed: number;
  max_linear_speed: number; // teleop cap, m/s, 0.1–0.8
  max_turn_rate: number; // teleop cap, rad/s, 0.1–1.0
  obstacle_distance: number;
  navigation_mode: string;
  localization_method: string;
  path_planner: string;
  recovery_behavior: string;
  created_at: string;
  updated_at: string;
}

export interface EmergencyStop {
  id: string;
  robot_id: string;
  user_id: string;
  is_active: boolean;
  triggered_at: string | null;
  released_at: string | null;
  triggered_by: string;
  reason: string;
  created_at: string;
}

export interface RobotSensor {
  id: string;
  robot_id: string;
  name: string;
  model: string;
  status: "live" | "software" | "offline";
  frequency: string;
  temperature: number | null;
  created_at: string;
}

export interface MapData {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: string;
  source: string;
  resolution: number;
  width: number;
  height: number;
  map_data: unknown;
  created_at: string;
  updated_at: string;
}

export interface SafetyZone {
  id: string;
  map_id: string;
  name: string;
  zone_type: string;
  vertices: { x: number; y: number }[];
  color: string;
  created_at: string;
}

export interface Waypoint {
  x: number;
  y: number;
  theta?: number;
  order: number;
  label?: string;
}

export interface Mission {
  id: string;
  user_id: string;
  map_id: string;
  name: string;
  status: string;
  waypoints: Waypoint[];
  created_at: string;
  updated_at: string;
}

export interface ScheduledRoute {
  id: string;
  user_id: string;
  map_id: string;
  name: string;
  description: string;
  waypoints: Waypoint[];
  schedule_type: "once" | "daily" | "weekly" | "custom";
  schedule_date: string | null;
  schedule_time: string | null;
  recurrence_days: string[];
  is_active: boolean;
  priority: number;
  estimated_duration: number;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleExecution {
  id: string;
  scheduled_route_id: string;
  user_id: string;
  mission_id: string | null;
  scheduled_for: string;
  status:
    | "pending"
    | "triggered"
    | "executing"
    | "completed"
    | "failed"
    | "skipped"
    | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  waypoints_completed: number;
  waypoints_total: number;
  trigger_source: "automatic" | "manual";
  created_at: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  mode?: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  robot_id: string;
  mode: string;
  messages: Message[];
  updated_at: string;
}
