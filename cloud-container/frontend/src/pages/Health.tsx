/** Frontend README's "Health page" - the backend's own /health and
 * /metrics (app/api/health.py), which is also what this app's runtime
 * relies on (see App.tsx's boot-time connectivity check, the spiritual
 * successor of Milestone 2's original stub page). */
import { useEffect, useState } from 'react'
import { getHealth, getMetrics } from '../api/client'
import type { HealthResponse, MetricsResponse } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusDot } from '../components/StatusDot'

const POLL_INTERVAL_MS = 5000

export function Health() {
  const { token } = useAuth()
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    async function poll() {
      try {
        const [healthData, metricsData] = await Promise.all([getHealth(), getMetrics(token as string)])
        if (cancelled) return
        setHealth(healthData)
        setMetrics(metricsData)
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
  }, [token])

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-semibold">Backend Health</h1>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Service</h2>
          <StatusDot variant={health?.status === 'ok' ? 'ok' : 'error'} label={health?.status ?? 'unknown'} />
        </div>
        <dl className="text-sm text-slate-400 space-y-1">
          <div className="flex justify-between">
            <dt>Service</dt>
            <dd className="text-slate-200">{health?.service ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>MQTT connected</dt>
            <dd className="text-slate-200">{health ? String(health.mqtt_connected) : '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Last check</dt>
            <dd className="text-slate-200">{health?.timestamp ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="font-medium">Fleet metrics</h2>
        <dl className="text-sm text-slate-400 space-y-1">
          <div className="flex justify-between">
            <dt>Robots known</dt>
            <dd className="text-slate-200">{metrics?.robots_known ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Robots online</dt>
            <dd className="text-slate-200">{metrics?.robots_online ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Robots in use</dt>
            <dd className="text-slate-200">{metrics?.robots_in_use ?? '—'}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
