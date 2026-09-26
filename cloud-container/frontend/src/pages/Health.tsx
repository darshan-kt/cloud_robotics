/** Frontend README's "Health page" - the backend's own /health and
 * /metrics (app/api/health.py), which is also what this app's runtime
 * relies on (see App.tsx's boot-time connectivity check, the spiritual
 * successor of Milestone 2's original stub page).
 *
 * Recomposed as a status board: the one question this page answers ("is
 * the backend up") is now the headline, and the raw ISO timestamp is
 * rendered as an age in seconds, which is the form an operator can
 * actually judge. A failed poll no longer leaves stale numbers on screen
 * looking current.
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Broadcast, PlugsConnected } from '@phosphor-icons/react'
import { getHealth, getMetrics } from '../api/client'
import type { HealthResponse, MetricsResponse } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import {
  Button,
  DataRow,
  ErrorNote,
  Metric,
  Panel,
  PanelHeader,
  PageHeader,
  Skeleton,
  StatusChip,
  cx,
} from '../components/ui'

const POLL_INTERVAL_MS = 5000

export function Health() {
  const { token } = useAuth()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastOk, setLastOk] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    async function poll() {
      try {
        const [healthData, metricsData] = await Promise.all([getHealth(), getMetrics(token as string)])
        if (cancelled) return
        setHealth(healthData)
        setMetrics(metricsData)
        setLastOk(Date.now())
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not reach the backend.')
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [token, refreshKey])

  // Drives the "checked Ns ago" readout, so a page left open doesn't
  // quietly present a five-minute-old answer as the current one.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const loading = health === null && error === null
  const ok = health?.status === 'ok' && error === null
  const ageSeconds = lastOk === null ? null : Math.max(0, Math.round((now - lastOk) / 1000))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Backend health"
        lede={
          ageSeconds === null
            ? 'Polling the control plane every five seconds'
            : `Last successful check ${ageSeconds}s ago`
        }
        actions={
          <Button variant="secondary" size="md" onClick={refresh}>
            <ArrowClockwise size={16} />
            Check now
          </Button>
        }
      />

      {error && (
        <ErrorNote
          action={
            <Button variant="secondary" size="sm" onClick={refresh}>
              Retry
            </Button>
          }
        >
          {error} Readings below are from the last successful check.
        </ErrorNote>
      )}

      {/* The verdict, at display size, before any of the supporting
          detail. This page exists to answer one question. */}
      <div
        className={cx(
          'flex flex-wrap items-center justify-between gap-6 rounded-lg border px-6 py-7',
          loading
            ? 'border-hairline bg-canvas'
            : ok
              ? 'border-success/35 bg-success/[0.07]'
              : 'border-error/35 bg-error/[0.07]',
        )}
      >
        <div>
          <span className="text-caption-up font-medium uppercase text-muted">Control plane</span>
          {loading ? (
            <Skeleton className="mt-2 h-9 w-52" />
          ) : (
            <p className={cx('mt-1 font-display text-display-md', ok ? 'text-[#33684a]' : 'text-[#8f3232]')}>
              {ok ? 'Operational' : 'Not responding'}
            </p>
          )}
        </div>
        <StatusChip
          variant={health?.mqtt_connected ? 'ok' : loading ? 'pending' : 'error'}
          label={loading ? 'Checking broker' : health?.mqtt_connected ? 'Broker connected' : 'Broker down'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <PlugsConnected size={14} />
                Service
              </span>
            }
          />
          <dl className="divide-y divide-hairline-soft px-5 py-2">
            <DataRow label="Service" value={health?.service ?? '--'} mono />
            <DataRow label="MQTT broker" value={health ? (health.mqtt_connected ? 'Connected' : 'Disconnected') : '--'} />
            <DataRow
              label="Reported at"
              value={health?.timestamp ? formatTimestamp(health.timestamp) : '--'}
              mono
            />
            <DataRow label="Poll interval" value={`${POLL_INTERVAL_MS / 1000}s`} />
          </dl>
        </Panel>

        <Panel>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <Broadcast size={14} />
                Fleet metrics
              </span>
            }
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 px-5 py-6">
            <Metric label="Known" value={metrics?.robots_known ?? null} />
            <Metric label="Online" value={metrics?.robots_online ?? null} />
            <Metric
              label="Offline"
              value={metrics ? metrics.robots_known - metrics.robots_online : null}
            />
            <Metric label="In use" value={metrics?.robots_in_use ?? null} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

/** The backend sends an ISO 8601 string. Printing it raw gave operators a
 *  29-character machine timestamp to parse by eye; this keeps the clock
 *  time, which is the part they compare against their own. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleTimeString(undefined, { hour12: false })
}
