import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'

// The shape ProtectedRoute stashes in router state when it redirects here
// (see auth/ProtectedRoute.tsx) - just enough to send the operator back
// where they were headed after a successful login.
interface LocationState {
  from?: { pathname: string }
}

export function Login() {
  const { isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already have a valid session (e.g. opened /login directly with a
  // token still in localStorage) - bounce straight past this page.
  if (isAuthenticated) {
    const from = (location.state as LocationState | null)?.from
    return <Navigate to={from?.pathname ?? '/dashboard'} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username, password)
      const from = (location.state as LocationState | null)?.from
      navigate(from?.pathname ?? '/dashboard', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid username or password.')
      } else {
        setError(err instanceof Error ? err.message : 'Login failed - is the backend reachable?')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-6"
      >
        <div>
          <h1 className="text-2xl font-semibold">Cloud Robotics Console</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to operate the fleet</p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm text-slate-300">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="mt-1 w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-300">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-md bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 transition-colors"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
