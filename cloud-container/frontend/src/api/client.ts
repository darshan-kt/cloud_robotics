/**
 * Typed fetch wrapper for the backend REST API (cloud-container/backend/app/api/*.py).
 *
 * Every function here resolves the base URL through `getRuntimeConfig()`
 * (src/config.ts) rather than a build-time constant - that's the whole
 * point of the runtime-config-injection pattern: one built JS bundle,
 * any backend address, chosen at container startup. See
 * docs/02-docker-foundations.md.
 *
 * Auth: the bearer token is passed in explicitly by callers (read from
 * AuthContext) rather than this module reaching into localStorage itself -
 * keeps this file a pure "given a base URL and a token, talk to the API"
 * layer, with no knowledge of how the token is stored or refreshed. See
 * src/auth/AuthContext.tsx.
 */
import { getRuntimeConfig } from '../config'
import type {
  Command,
  HealthResponse,
  MetricsResponse,
  RobotDetail,
  RobotSummary,
  SessionInfo,
  TokenResponse,
  WebRTCAnswer,
} from './types'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function resolveBaseUrl(): Promise<string> {
  const { apiBaseUrl } = await getRuntimeConfig()
  return apiBaseUrl
}

/** Turns the base URL (http://host:port) into a ws:// or wss:// URL with
 * the same host/port - used by the WebSocket hooks (useStatusSocket,
 * useTeleopSocket) since they can't go through `fetch`. */
export async function resolveWsBaseUrl(): Promise<string> {
  const base = await resolveBaseUrl()
  return base.replace(/^http/, 'ws')
}

async function request<T>(
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  const baseUrl = await resolveBaseUrl()
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      message = data.detail ?? message
    } catch {
      // Response body wasn't JSON (or was empty) - fall back to the
      // generic status-code message above.
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function login(username: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', { method: 'POST', body: { username, password } })
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health')
}

export async function getMetrics(token: string): Promise<MetricsResponse> {
  return request<MetricsResponse>('/metrics', { token })
}

export async function listRobots(token: string): Promise<RobotSummary[]> {
  return request<RobotSummary[]>('/robots', { token })
}

export async function getRobot(token: string, robotId: string): Promise<RobotDetail> {
  return request<RobotDetail>(`/robots/${encodeURIComponent(robotId)}`, { token })
}

export async function acquireSession(token: string, robotId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/robots/${encodeURIComponent(robotId)}/session`, {
    method: 'POST',
    token,
  })
}

export async function releaseSession(token: string, robotId: string): Promise<void> {
  await request<void>(`/robots/${encodeURIComponent(robotId)}/session`, {
    method: 'DELETE',
    token,
  })
}

export async function sendControl(token: string, robotId: string, command: Command): Promise<void> {
  await request<{ status: string }>(`/robots/${encodeURIComponent(robotId)}/control`, {
    method: 'POST',
    token,
    body: { command },
  })
}

export async function emergencyStop(token: string, robotId: string): Promise<void> {
  await request<{ status: string }>(`/robots/${encodeURIComponent(robotId)}/stop`, {
    method: 'POST',
    token,
  })
}

export async function relayWebRTCOffer(token: string, robotId: string, sdp: string): Promise<WebRTCAnswer> {
  return request<WebRTCAnswer>(`/robots/${encodeURIComponent(robotId)}/webrtc/offer`, {
    method: 'POST',
    token,
    body: { sdp },
  })
}
