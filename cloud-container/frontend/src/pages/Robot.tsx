/** The frontend README's "Robot page": live camera (WebRTC), arrow-button
 * + keyboard teleop (throttled to 20Hz), connection status, robot state,
 * battery, velocity, and emergency stop.
 *
 * Watching video and driving are independent (see api/webrtc.py's
 * docstring) - the <video> negotiates as soon as the page loads,
 * regardless of whether the operator has taken control. Taking control is
 * an explicit action (a button) that opens /ws/teleop/{robot_id}, which is
 * what actually acquires the session server-side - see hooks/useTeleopSocket.ts.
 *
 * Composition note: this page used to be four visually identical panels
 * stacked in a rail, which gave the emergency stop, a velocity reading
 * and a CPU percentage the same weight. It is now read in the order an
 * operator actually needs it - command bar, camera, controls, then
 * telemetry and health as reference bands - and the live robot surfaces
 * (camera, teleop, LiDAR) sit on the dark `instrument` tone while console
 * chrome stays on cream, which is DESIGN.md's cream/dark pacing applied
 * as a rule rather than a mood.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Crosshair,
  Cpu,
  GameController,
  Gauge,
  Memory,
  PlugsConnected,
  Prohibit,
  VideoCamera,
  Warning,
} from '@phosphor-icons/react'
import { ApiError, emergencyStop, getRobot } from '../api/client'
import { isHealth, isLaserScan, isTelemetry } from '../api/types'
import type { RobotDetail, RobotStatus } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { LidarView } from '../components/LidarView'
import { useFleet } from '../components/Layout'
import { TeleopPad } from '../components/TeleopPad'
import {
  Button,
  EmptyState,
  ErrorNote,
  Meter,
  Metric,
  Panel,
  PanelHeader,
  Skeleton,
  StatusChip,
  cx,
} from '../components/ui'
import { useKeyboardTeleop } from '../hooks/useKeyboardTeleop'
import { useTeleopSocket } from '../hooks/useTeleopSocket'
import { useThrottledTeleop } from '../hooks/useThrottledTeleop'
import { useWebRTCVideo } from '../hooks/useWebRTCVideo'

// 500ms - fast enough that the LiDAR panel and telemetry feel genuinely
// live while driving, not the 2s this polled at before the LiDAR panel
// existed. Still a plain REST poll of GET /robots/{id}, not a WebSocket -
// see docs/09-frontend.md's own reasoning for why /ws/status's 2s push is
// fine for a fleet dashboard; this page is the one place a tighter number
// actually matters, and polling 2x/sec is negligible load for a single
// operator's own browser.
const POLL_INTERVAL_MS = 500

// A successful stop is a transient acknowledgement, not a standing
// condition - it clears itself so it can't be mistaken for the robot
// still being held. Failures stay until the operator retries.
const STOP_ACK_TIMEOUT_MS = 4000

const STATUS_VARIANT = { online: 'ok', unknown: 'warn', offline: 'error' } as const

export function Robot() {
  const { robotId } = useParams<{ robotId: string }>()
  const { token } = useAuth()
  const { robots } = useFleet()

  const [detail, setDetail] = useState<RobotDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [controlEnabled, setControlEnabled] = useState(false)
  const [stopState, setStopState] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const [stopping, setStopping] = useState(false)

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

  useEffect(() => {
    if (stopState?.kind !== 'ok') return
    const timer = setTimeout(() => setStopState(null), STOP_ACK_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [stopState])

  async function handleEmergencyStop() {
    if (!token || !robotId) return
    setStopping(true)
    setStopState(null)
    try {
      await emergencyStop(token, robotId)
      setStopState({ kind: 'ok', message: 'Stop sent. The robot has been commanded to halt.' })
    } catch (err) {
      setStopState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to send stop. Try again.',
      })
    } finally {
      setStopping(false)
    }
  }

  if (detailError) {
    return (
      <EmptyState
        icon={<Warning size={24} />}
        title="Robot unavailable"
        description={detailError}
        action={
          <Link
            to="/dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-coral-active px-5 text-button font-medium text-on-coral transition-colors hover:bg-[#8f4934] active:translate-y-px"
          >
            <ArrowLeft size={16} />
            Back to fleet
          </Link>
        }
      />
    )
  }

  // Validated, not trusted: these three are raw MQTT pass-throughs and a
  // real robot on this fleet publishes shapes that don't match the
  // interface at all. See the guards in api/types.ts.
  const telemetry = isTelemetry(detail?.telemetry) ? detail.telemetry : null
  const health = isHealth(detail?.health) ? detail.health : null
  const lidar = isLaserScan(detail?.lidar) ? detail.lidar : null
  // Before the first poll lands, the shared status feed already knows the
  // robot's name and state, so the header is never blank on arrival.
  const summary = detail ?? robots.find((r) => r.robot_id === robotId) ?? null
  const status: RobotStatus | null = summary?.status ?? null
  const loading = detail === null

  return (
    <div className="flex flex-col gap-6">
      <CommandBar
        robotId={robotId ?? ''}
        displayName={summary?.display_name}
        status={status}
        battery={summary?.battery_percentage ?? null}
        inUseBy={summary?.in_use_by ?? null}
        stopping={stopping}
        onStop={handleEmergencyStop}
      />

      {/* Assertive: an operator who just hit the stop needs to hear the
          result whether or not their attention is on this element. */}
      <div aria-live="assertive" aria-atomic="true">
        {stopState &&
          (stopState.kind === 'ok' ? (
            <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-4 py-3 text-body-sm text-[#33684a]">
              <Prohibit size={16} weight="bold" />
              {stopState.message}
            </p>
          ) : (
            <ErrorNote
              action={
                <Button variant="secondary" size="sm" onClick={handleEmergencyStop} disabled={stopping}>
                  Retry stop
                </Button>
              }
            >
              {stopState.message}
            </ErrorNote>
          ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:grid-rows-[auto_auto]">
        {/* Camera. Largest element on the page because it is the one an
            operator's eyes live on while driving. */}
        <Panel tone="instrument" stage className="overflow-hidden lg:col-span-2 lg:row-start-1">
          <div className="relative aspect-video w-full bg-black">
            <video
              ref={video.videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-contain"
              aria-label={`Live camera feed from ${summary?.display_name || robotId}`}
            />
            {video.state !== 'connected' && <VideoPlaceholder state={video.state} message={video.error} />}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <StatusChip
              tone="instrument"
              variant={video.state === 'connected' ? 'ok' : video.state === 'failed' ? 'error' : 'pending'}
              label={`Camera ${video.state}`}
            />
            {/* 'in-use' means another operator holds the feed. Taking it
                over ends their stream, so it's an explicit button rather
                than something that happens by opening this page - see
                docs/security-findings.md F3. */}
            {video.state === 'in-use' ? (
              <Button variant="primary" size="sm" onClick={video.takeOver}>
                Take over camera
              </Button>
            ) : (
              video.error && <span className="text-caption text-[#e08a8a]">{video.error}</span>
            )}
          </div>
        </Panel>

        {/* Controls column: the two surfaces an operator touches. */}
        <div className="flex flex-col gap-6 lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <Panel tone="instrument">
            <PanelHeader
              tone="instrument"
              title={
                <span className="flex items-center gap-2">
                  <GameController size={14} />
                  Teleop
                </span>
              }
              aside={
                controlEnabled ? (
                  <Button variant="instrument" size="sm" onClick={() => setControlEnabled(false)}>
                    Release
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setControlEnabled(true)}>
                    Take control
                  </Button>
                )
              }
            />
            <div className="flex flex-col items-center gap-4 px-5 py-5">
              <StatusChip
                tone="instrument"
                variant={
                  teleop.state === 'connected' ? 'ok' : teleop.state === 'error' ? 'error' : teleop.state === 'idle' ? 'idle' : 'pending'
                }
                label={`Session ${teleop.state}`}
                className="self-start"
              />
              {teleop.error && <p className="self-start text-caption text-[#e08a8a]">{teleop.error}</p>}
              <TeleopPad
                activeCommand={activeCommand}
                onStart={start}
                onStop={stop}
                disabled={!controlEnabled || teleop.state !== 'connected'}
              />
            </div>
          </Panel>

          <Panel tone="instrument">
            <PanelHeader
              tone="instrument"
              title={
                <span className="flex items-center gap-2">
                  <Crosshair size={14} />
                  LiDAR
                </span>
              }
              aside={
                <span className="font-mono tnum text-caption text-on-instrument-soft">
                  {lidar ? `${lidar.ranges.length} pts` : '--'}
                </span>
              }
            />
            <div className="px-5 py-5">
              <LidarView scan={lidar} />
            </div>
          </Panel>
        </div>

        {/* Reference data. Deliberately a different shape from the panels
            above: numbers on cream, divided by hairlines, no containers
            of their own. */}
        <div className="flex flex-col gap-6 lg:col-span-2 lg:col-start-1 lg:row-start-2">
          <Telemetry telemetry={telemetry} loading={loading} />
          <Health health={health} loading={loading} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CommandBar({
  robotId,
  displayName,
  status,
  battery,
  inUseBy,
  stopping,
  onStop,
}: {
  robotId: string
  displayName?: string
  status: RobotStatus | null
  battery: number | null
  inUseBy: string | null
  stopping: boolean
  onStop: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-body-sm font-medium text-muted transition-colors hover:text-coral-active"
      >
        <ArrowLeft size={15} />
        Fleet
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <h1 className="truncate font-display text-display-md text-ink">{displayName || robotId}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* A robot with no friendly name reports its ID as the display
                name, and printing both would just repeat the headline. */}
            {displayName && displayName !== robotId && (
              <span className="font-mono text-caption text-muted-soft">{robotId}</span>
            )}
            {status && <StatusChip variant={STATUS_VARIANT[status]} label={status} />}
            {battery !== null && (
              <span className="font-mono tnum text-caption text-muted">{battery.toFixed(0)}% battery</span>
            )}
            {inUseBy && (
              <span className="rounded-pill bg-coral-active px-3 py-1 text-caption-up font-medium uppercase text-on-coral">
                Held by {inUseBy}
              </span>
            )}
          </div>
        </div>

        {/* The only red element in the console, at the largest button
            size, always in the same place on every robot page. */}
        <Button variant="danger" size="lg" onClick={onStop} disabled={stopping} className="shrink-0">
          <Prohibit size={20} weight="bold" />
          {stopping ? 'Stopping' : 'Emergency stop'}
        </Button>
      </div>
    </div>
  )
}

/** The camera is a real feed, so when there is nothing to show this says
 *  which of the four reasons it is rather than leaving a black rectangle
 *  that looks identical to a broken player. */
function VideoPlaceholder({ state, message }: { state: string; message: string | null }) {
  const copy: Record<string, { title: string; body: string }> = {
    idle: { title: 'Camera idle', body: 'Waiting to negotiate a connection with the robot.' },
    negotiating: { title: 'Connecting to camera', body: 'Exchanging ICE candidates through the TURN relay.' },
    failed: { title: 'Camera unavailable', body: message ?? 'The video connection could not be established.' },
    'in-use': { title: 'Camera in use', body: message ?? 'Another operator is holding this feed.' },
  }
  const { title, body } = copy[state] ?? copy.idle

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-instrument px-6 text-center">
      <VideoCamera
        size={28}
        className={cx('text-on-instrument-soft', state === 'negotiating' && 'motion-safe:animate-breathe')}
      />
      <div>
        <p className="text-title-sm font-medium text-on-instrument">{title}</p>
        <p className="mt-1 max-w-[42ch] text-body-sm text-on-instrument-soft">{body}</p>
      </div>
    </div>
  )
}

function Telemetry({ telemetry, loading }: { telemetry: RobotDetail['telemetry']; loading: boolean }) {
  if (loading) {
    return <BandSkeleton label="Telemetry" count={6} />
  }

  if (!telemetry) {
    return (
      <Band title="Telemetry" icon={<Gauge size={14} />}>
        <p className="px-5 py-6 text-body-sm text-muted">
          No telemetry received yet. The robot publishes on its own cadence, so this fills in once it does.
        </p>
      </Band>
    )
  }

  return (
    <Band title="Telemetry" icon={<Gauge size={14} />}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Linear" value={telemetry.velocity.linear.toFixed(2)} unit="m/s" size="sm" />
        <Metric label="Angular" value={telemetry.velocity.angular.toFixed(2)} unit="rad/s" size="sm" />
        <Metric label="Position X" value={telemetry.position.x.toFixed(2)} unit="m" size="sm" />
        <Metric label="Position Y" value={telemetry.position.y.toFixed(2)} unit="m" size="sm" />
        <Metric label="Heading" value={telemetry.position.heading.toFixed(2)} unit="rad" size="sm" />
        <Metric
          label="Battery"
          value={telemetry.battery_percentage !== null ? telemetry.battery_percentage.toFixed(0) : null}
          unit="%"
          size="sm"
        />
      </div>
    </Band>
  )
}

function Health({ health, loading }: { health: RobotDetail['health']; loading: boolean }) {
  if (loading) {
    return <BandSkeleton label="Onboard health" count={4} />
  }

  if (!health) {
    return (
      <Band title="Onboard health" icon={<Cpu size={14} />}>
        <p className="px-5 py-6 text-body-sm text-muted">No health data received yet.</p>
      </Band>
    )
  }

  return (
    <Band title="Onboard health" icon={<Cpu size={14} />}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 lg:grid-cols-4">
        <div>
          <Metric label="CPU" value={health.cpu_percent !== null ? health.cpu_percent.toFixed(0) : null} unit="%" size="sm" />
          <Meter value={health.cpu_percent} className="mt-2.5 max-w-[8rem]" label="CPU load" />
        </div>
        <div>
          <Metric
            label="Memory"
            value={health.memory_percent !== null ? health.memory_percent.toFixed(0) : null}
            unit="%"
            size="sm"
          />
          <Meter value={health.memory_percent} className="mt-2.5 max-w-[8rem]" label="Memory use" />
        </div>
        <Metric
          label="Temperature"
          value={health.temperature_c !== null ? health.temperature_c.toFixed(1) : null}
          unit="°C"
          size="sm"
        />
        <div>
          <span className="text-caption-up font-medium uppercase text-muted-soft">Broker</span>
          <span className="mt-1.5 flex items-center gap-2">
            <PlugsConnected size={17} className={health.mqtt_connected ? 'text-success' : 'text-error'} />
            <span className="text-title-sm font-medium text-ink">
              {health.mqtt_connected ? 'Connected' : 'Disconnected'}
            </span>
          </span>
        </div>
      </div>
    </Band>
  )
}

function Band({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
        }
      />
      {children}
    </Panel>
  )
}

function BandSkeleton({ label, count }: { label: string; count: number }) {
  return (
    <Panel>
      <PanelHeader title={<span className="flex items-center gap-2"><Memory size={14} />{label}</span>} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 sm:grid-cols-3 lg:grid-cols-6" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
    </Panel>
  )
}
