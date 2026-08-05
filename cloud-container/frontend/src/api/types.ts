/**
 * TypeScript mirrors of the backend's Pydantic response models
 * (cloud-container/backend/app/models.py) - kept in this one file, by
 * hand, rather than generated from the OpenAPI schema. This app is small
 * enough that a codegen step would be more machinery than the five shapes
 * below actually need; if the API surface grows a lot, generating these
 * from `/openapi.json` (FastAPI serves it for free) would be the natural
 * next step - noted here rather than silently deferred.
 */

// The five commands the robot's dispatcher understands - see
// robot-container/robot_agent/dispatcher.py and docs/03-mqtt-layer.md.
export type Command = 'forward' | 'backward' | 'left' | 'right' | 'stop'

export type RobotStatus = 'online' | 'offline' | 'unknown'

export interface RobotSummary {
  robot_id: string
  display_name: string
  status: RobotStatus
  last_seen: string | null
  battery_percentage: number | null
  in_use_by: string | null
}

export interface RobotDetail extends RobotSummary {
  telemetry: RobotTelemetry | null
  health: RobotHealth | null
  lidar: LaserScan | null
}

// Shapes of the raw MQTT payloads robot_agent/agent.py publishes - see
// docs/03-mqtt-layer.md and robot_agent/agent.py's publish_telemetry()/
// publish_health(). Passed through the backend unmodified (see
// registry/store.py), so these mirror the robot side, not the backend.
export interface RobotTelemetry {
  robot_id: string
  timestamp: number
  velocity: { linear: number; angular: number }
  position: { x: number; y: number; heading: number }
  battery_percentage: number | null
}

export interface RobotHealth {
  robot_id: string
  timestamp: number
  cpu_percent: number | null
  memory_percent: number | null
  temperature_c: number | null
  mqtt_connected: boolean
}

// robot_agent/agent.py's publish_lidar_scan() payload, passed through
// unmodified by the backend (see registry/store.py) - same "mirrors the
// robot side, not a backend-defined shape" reasoning as RobotTelemetry/
// RobotHealth above. `ranges[i]` is the reading at angle `angle_min + i *
// angle_increment`; `null` means "nothing detected within range" (the
// robot side already converts ROS2's `inf` to `null` - see
// real_ros_adapter.py's _handle_laser_scan() - since `Infinity` isn't
// valid JSON and would break JSON.parse() here).
export interface LaserScan {
  robot_id: string
  timestamp: number
  angle_min: number
  angle_max: number
  angle_increment: number
  range_min: number
  range_max: number
  ranges: (number | null)[]
}

export interface SessionInfo {
  session_id: string
  robot_id: string
  operator: string
  acquired_at: string
  expires_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
}

export interface HealthResponse {
  status: string
  service: string
  mqtt_connected: boolean
  timestamp: string
}

export interface MetricsResponse {
  robots_known: number
  robots_online: number
  robots_in_use: number
  mqtt_connected: boolean
}

export interface WebRTCAnswer {
  sdp: string
}

// /ws/status's push payload - see cloud-container/backend/app/ws/status.py.
export interface StatusStreamMessage {
  robots: RobotSummary[]
}

// /ws/teleop/{robot_id}'s message shapes - see
// cloud-container/backend/app/ws/teleop.py.
export type TeleopServerMessage =
  | { status: 'session_acquired'; robot_id: string }
  | { status: 'sent'; command: Command }
  | { error: string }
