/** The frontend README's "Robot page": live camera (WebRTC), arrow-button
 * + keyboard teleop (throttled to 20Hz), connection status, robot state,
 * battery, velocity, and emergency stop.
 *
 * Watching video and driving are independent (see api/webrtc.py's
 * docstring) - the <video> negotiates as soon as the page loads,
 * regardless of whether the operator has taken control. Taking control is
 * an explicit action (a button) that opens /ws/teleop/{robot_id}, which is
 * what actually acquires the session server-side - see hooks/useTeleopSocket.ts.
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, emergencyStop, getRobot } from '../api/client'
import type { RobotDetail } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusDot } from '../components/StatusDot'
import { TeleopPad } from '../components/TeleopPad'
import { useKeyboardTeleop } from '../hooks/useKeyboardTeleop'
import { useTeleopSocket } from '../hooks/useTeleopSocket'
import { useThrottledTeleop } from '../hooks/useThrottledTeleop'
import { useWebRTCVideo } from '../hooks/useWebRTCVideo'

const POLL_INTERVAL_MS = 2000

export function Robot() {
  const { robotId } = useParams<{ robotId: string }>()
  const { token } = useAuth()

  const [detail, setDetail] = useState<RobotDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [controlEnabled, setControlEnabled] = useState(false)
  const [stopMessage, setStopMessage] = useState<string | null>(null)

  const video = useWebRTCVideo(token, robotId ?? null, true)
  const teleop = useTeleopSocket(token, robotId ?? null, controlEnabled)
  const { activeCommand, start, stop } = useThrottledTeleop(teleop.sendCommand)
  useKeyboardTeleop(start, stop, controlEnabled && teleop.state === 'connected')

  // Poll REST for telemetry/health - the status WebSocket only carries
  // RobotSummary fields (see docs/07-cloud-backend.md); the detail
  // endpoint is the only one that includes the raw telemetry/health dicts.
  useEffect(() => {
    if (!token || !robotId) return
    let cancelled = false

    async function poll() {
      try {
        const data = await getRobot(token as string, robotId as string)
        if (!cancelled) {
          setDetail(data)
          setDetailError(null)
        }
      } catch (err) {
        if (cancelled) return
        setDetailError(
          err instanceof ApiError && err.status === 404
            ? `Unknown robot '${robotId}'`
            : 'Could not reach the backend for robot details.',
        )
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [token, robotId])

  // If the teleop socket closes or errors on its own (session TTL expiry,
  // another operator's stop, network drop), fall back to "not in
  // control" so the Take Control button is available to retry rather
  // than silently doing nothing.
  useEffect(() => {
    if (controlEnabled && (teleop.state === 'closed' || teleop.state === 'error')) {
      setControlEnabled(false)
    }
  }, [teleop.state, controlEnabled])

  async function handleEmergencyStop() {
    if (!token || !robotId) return
    setStopMessage(null)
    try {
      await emergencyStop(token, robotId)
      setStopMessage('Stop sent.')
    } catch (err) {
      setStopMessage(err instanceof Error ? err.message : 'Failed to send stop.')
    }
  }

  if (detailError) {
    return (
      <div className="space-y-4">
        <p className="text-red-400">{detailError}</p>
        <Link to="/dashboard" className="text-sky-400 hover:underline text-sm">
          ← Back to dashboard
        </Link>
      </div>
    )
  }

  const telemetry = detail?.telemetry
  const health = detail?.health

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/dashboard" className="text-sky-400 hover:underline text-sm">
            ← Fleet
          </Link>
          <h1 className="text-xl font-semibold mt-1">{detail?.display_name ?? robotId}</h1>
        </div>
        <button
          onClick={handleEmergencyStop}
          className="px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors"
        >
          Emergency Stop
        </button>
      </div>
      {stopMessage && <p className="text-sm text-slate-400">{stopMessage}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-black rounded-xl overflow-hidden border border-slate-800 aspect-video flex items-center justify-center">
            <video ref={video.videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center justify-between">
            <StatusDot
              variant={video.state === 'connected' ? 'ok' : video.state === 'failed' ? 'error' : 'pending'}
              label={`Video: ${video.state}`}
            />
            {video.error && <span className="text-xs text-red-400">{video.error}</span>}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Teleop</h2>
              {controlEnabled ? (
                <button
                  onClick={() => setControlEnabled(false)}
                  className="text-xs px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Release control
                </button>
              ) : (
                <button
                  onClick={() => setControlEnabled(true)}
                  className="text-xs px-2 py-1 rounded-md bg-sky-500 hover:bg-sky-400 text-white"
                >
                  Take control
                </button>
              )}
            </div>
            <StatusDot
              variant={teleop.state === 'connected' ? 'ok' : teleop.state === 'error' ? 'error' : 'pending'}
              label={`Session: ${teleop.state}`}
            />
            {teleop.error && <p className="text-xs text-red-400">{teleop.error}</p>}
            <TeleopPad
              activeCommand={activeCommand}
              onStart={start}
              onStop={stop}
              disabled={!controlEnabled || teleop.state !== 'connected'}
            />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
            <h2 className="font-medium mb-2">Telemetry</h2>
            {telemetry ? (
              <dl className="text-sm text-slate-400 space-y-1">
                <Row label="Linear velocity" value={`${telemetry.velocity.linear.toFixed(2)} m/s`} />
                <Row label="Angular velocity" value={`${telemetry.velocity.angular.toFixed(2)} rad/s`} />
                <Row
                  label="Position"
                  value={`x=${telemetry.position.x.toFixed(2)} y=${telemetry.position.y.toFixed(2)}`}
                />
                <Row label="Heading" value={`${telemetry.position.heading.toFixed(2)} rad`} />
                <Row
                  label="Battery"
                  value={telemetry.battery_percentage !== null ? `${telemetry.battery_percentage.toFixed(0)}%` : '—'}
                />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No telemetry received yet.</p>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-2">
            <h2 className="font-medium mb-2">Health</h2>
            {health ? (
              <dl className="text-sm text-slate-400 space-y-1">
                <Row label="CPU" value={health.cpu_percent !== null ? `${health.cpu_percent.toFixed(0)}%` : '—'} />
                <Row
                  label="Memory"
                  value={health.memory_percent !== null ? `${health.memory_percent.toFixed(0)}%` : '—'}
                />
                <Row
                  label="Temperature"
                  value={health.temperature_c !== null ? `${health.temperature_c.toFixed(1)}°C` : '—'}
                />
                <Row label="MQTT" value={health.mqtt_connected ? 'connected' : 'disconnected'} />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No health data received yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  )
}
