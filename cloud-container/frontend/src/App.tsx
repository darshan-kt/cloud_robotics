import { useEffect, useState } from 'react'
import { getRuntimeConfig } from './config'

interface HealthResponse {
  status: string
  service: string
  timestamp: string
}

type ConnectionState = 'checking' | 'connected' | 'disconnected'

function App() {
  const [state, setState] = useState<ConnectionState>('checking')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('')

  useEffect(() => {
    let cancelled = false

    async function checkHealth() {
      try {
        const { apiBaseUrl: baseUrl } = await getRuntimeConfig()
        if (cancelled) return
        setApiBaseUrl(baseUrl)

        const res = await fetch(`${baseUrl}/health`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as HealthResponse
        if (cancelled) return
        setHealth(data)
        setState('connected')
      } catch {
        if (!cancelled) setState('disconnected')
      }
    }

    checkHealth()
    const interval = setInterval(checkHealth, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Cloud Robotics Platform</h1>
          <p className="text-slate-400 text-sm mt-1">Milestone 2 — Docker Foundations</p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`h-3 w-3 rounded-full ${
              state === 'connected'
                ? 'bg-emerald-500'
                : state === 'checking'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-red-500'
            }`}
          />
          <span className="font-medium">
            {state === 'connected' && 'Backend connected'}
            {state === 'checking' && 'Checking backend…'}
            {state === 'disconnected' && 'Backend unreachable'}
          </span>
        </div>

        <div className="text-sm text-slate-400 space-y-1">
          <p>
            API base URL: <code className="text-slate-200">{apiBaseUrl || '—'}</code>
          </p>
          {health && (
            <>
              <p>
                Service: <code className="text-slate-200">{health.service}</code>
              </p>
              <p>
                Reported status: <code className="text-slate-200">{health.status}</code>
              </p>
              <p>
                Last check: <code className="text-slate-200">{health.timestamp}</code>
              </p>
            </>
          )}
        </div>

        <p className="text-xs text-slate-500 border-t border-slate-800 pt-4">
          This page proves Browser → React → FastAPI wiring. Live camera, teleop
          controls, and robot state arrive in later milestones.
        </p>
      </div>
    </div>
  )
}

export default App
