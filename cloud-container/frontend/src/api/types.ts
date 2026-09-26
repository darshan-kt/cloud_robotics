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

/**
 * Runtime guards for the three pass-through payloads.
 *
 * `telemetry`, `health` and `lidar` are forwarded from MQTT unmodified
 * (see the notes on each interface above), so the interfaces here describe
 * what a current robot_agent publishes, not what the backend guarantees.
 * A robot running an older agent, a partial payload, or a non-telemetry
 * frame that landed on the topic all deserialise with these fields simply
 * absent - and a live fleet does produce exactly that: the deployed
 * turtlebot reports `telemetry: {"cert-auth": true}` and a `lidar` object
 * carrying nothing but `ranges`.
 *
 * TypeScript cannot catch that, because the values are cast at the fetch
 * boundary. So the console validates the shape before reading it and
 * falls back to its own "no reading" state, rather than dereferencing
 * `undefined` and taking the whole page down with it.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

export function isTelemetry(value: unknown): value is RobotTelemetry {
  if (!value || typeof value !== 'object') return false
  const t = value as Partial<RobotTelemetry>
  return (
    !!t.velocity &&
    isFiniteNumber(t.velocity.linear) &&
    isFiniteNumber(t.velocity.angular) &&
    !!t.position &&
    isFiniteNumber(t.position.x) &&
    isFiniteNumber(t.position.y) &&
    isFiniteNumber(t.position.heading) &&
    isNullableNumber(t.battery_percentage)
  )
}

export function isHealth(value: unknown): value is RobotHealth {
  if (!value || typeof value !== 'object') return false
  const h = value as Partial<RobotHealth>
  return (
    isNullableNumber(h.cpu_percent) &&
    isNullableNumber(h.memory_percent) &&
    isNullableNumber(h.temperature_c) &&
    typeof h.mqtt_connected === 'boolean'
  )
}

export function isLaserScan(value: unknown): value is LaserScan {
  if (!value || typeof value !== 'object') return false
  const s = value as Partial<LaserScan>
  return (
    Array.isArray(s.ranges) &&
    isFiniteNumber(s.angle_min) &&
    isFiniteNumber(s.angle_increment) &&
    isFiniteNumber(s.range_min) &&
    isFiniteNumber(s.range_max) &&
    s.range_max > 0
  )
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

// POST /auth/ws-ticket (app/api/auth.py) - a short-lived, single-use
// credential the two WebSocket hooks exchange for immediately before
// connecting, instead of putting the long-lived bearer token in the URL.
// See docs/12-security-hardening.md.
export interface WsTicketResponse {
  ticket: string
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
