/** Sign-in. Recomposed from a centred card into DESIGN.md's 6/6 hero
 * split: the form sits on the cream canvas at the left, and the right
 * half is a flat dark band carrying the product name. The band is a
 * colour block, not a mocked-up screenshot of a console that doesn't
 * exist yet - the only imagery in this product is the real camera feed
 * and the real LiDAR plot, both of which need a session first. Below
 * `lg` the band drops away entirely and the form is the whole screen.
 */
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { BrandMark, Wordmark } from '../components/Brand'
import { Button, Field, cx, inputClass } from '../components/ui'

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
        setError(err instanceof Error ? err.message : 'Login failed. Is the backend reachable?')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-[100dvh] bg-canvas lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-sm animate-fade-rise">
          <Wordmark stacked />

          <h1 className="mt-10 font-display text-display-md text-ink">Sign in</h1>
          <p className="mt-2 text-body-md text-muted">
            Operator credentials are required to view or drive any machine in the fleet.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
            <Field label="Username" id="username">
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                aria-invalid={error ? true : undefined}
                className={inputClass}
              />
            </Field>

            <Field label="Password" id="password">
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                className={inputClass}
              />
            </Field>

            {/* Polite rather than assertive: the operator is already
                looking at the form they just submitted. */}
            <div aria-live="polite">
              {error && (
                <p
                  id="login-error"
                  className="rounded-md border border-error/35 bg-error/[0.07] px-3.5 py-2.5 text-caption font-medium text-[#8f3232]"
                >
                  {error}
                </p>
              )}
            </div>

            <Button type="submit" variant="primary" size="md" disabled={submitting} className="mt-1 w-full">
              {submitting ? 'Signing in' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>

      {/* Cream to dark is DESIGN.md's pacing device, used once here. */}
      <aside className={cx('hidden flex-col justify-between bg-instrument p-14 lg:flex')} aria-hidden="true">
        <BrandMark className="h-8 w-8 text-coral" />
        <div className="pb-4">
          <p className="max-w-[18ch] font-display text-display-lg text-on-instrument">
            Every machine, one console.
          </p>
          <p className="mt-5 max-w-[46ch] text-body-md text-on-instrument-soft">
            Live camera, LiDAR and telemetry for the whole fleet, with direct teleoperation of any robot that is
            online.
          </p>
        </div>
      </aside>
    </div>
  )
}
