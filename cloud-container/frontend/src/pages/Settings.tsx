/** Frontend README's "Settings page" - kept to what's actually real and
 * inspectable in this milestone (runtime config, session identity)
 * rather than stubbing out controls that don't do anything yet. There's
 * no per-operator preference store on the backend, so this isn't a form
 * that saves anywhere - it's a diagnostics/identity panel. */
import { useEffect, useState } from 'react'
import { getRuntimeConfig } from '../config'
import { useAuth } from '../auth/AuthContext'

export function Settings() {
  const { operator, expiresAt, logout } = useAuth()
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    getRuntimeConfig().then((config) => setApiBaseUrl(config.apiBaseUrl))
  }, [])

  // Live-updating countdown so "session expires in" is actually useful,
  // not a value frozen at page load.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const secondsRemaining = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : null

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="font-medium">Session</h2>
        <dl className="text-sm text-slate-400 space-y-1">
          <div className="flex justify-between">
            <dt>Operator</dt>
            <dd className="text-slate-200">{operator}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Token expires in</dt>
            <dd className="text-slate-200">{secondsRemaining !== null ? `${secondsRemaining}s` : '—'}</dd>
          </div>
        </dl>
        <button
          onClick={logout}
          className="mt-2 px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-sm"
        >
          Log out
        </button>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <h2 className="font-medium">Connection</h2>
        <dl className="text-sm text-slate-400 space-y-1">
          <div className="flex justify-between">
            <dt>API base URL</dt>
            <dd className="text-slate-200 font-mono text-xs">{apiBaseUrl || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Teleop command rate</dt>
            <dd className="text-slate-200">20 Hz (fixed)</dd>
          </div>
        </dl>
        <p className="text-xs text-slate-500 pt-2 border-t border-slate-800">
          The API base URL is injected at container startup (see docs/02-docker-foundations.md) - the same built
          frontend works against any backend address without a rebuild.
        </p>
      </section>
    </div>
  )
}
