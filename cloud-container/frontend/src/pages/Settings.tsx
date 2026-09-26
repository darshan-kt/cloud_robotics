/** Frontend README's "Settings page" - kept to what's actually real and
 * inspectable in this milestone (runtime config, session identity)
 * rather than stubbing out controls that don't do anything yet. There's
 * no per-operator preference store on the backend, so this isn't a form
 * that saves anywhere - it's a diagnostics/identity panel.
 *
 * The session countdown used to print raw seconds ("3241s"), which is not
 * a number anyone reads as a duration. It is now mm:ss, and it changes
 * colour as it approaches zero, because a token expiring mid-drive drops
 * the teleop socket.
 */
import { useEffect, useState } from 'react'
import { GearSix, Plugs, SignOut, UserCircle } from '@phosphor-icons/react'
import { getRuntimeConfig } from '../config'
import { useAuth } from '../auth/AuthContext'
import { Button, DataRow, Panel, PanelHeader, PageHeader, Skeleton, cx } from '../components/ui'

// Below five minutes the operator should be thinking about the session
// ending before it interrupts something, not after.
const EXPIRY_WARNING_S = 300

export function Settings() {
  const { operator, expiresAt, logout } = useAuth()
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null)
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
  const expiringSoon = secondsRemaining !== null && secondsRemaining <= EXPIRY_WARNING_S

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        lede="Session identity and the runtime configuration this console booted with."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <UserCircle size={14} />
                Session
              </span>
            }
          />
          <div className="px-5 py-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <span className="text-caption-up font-medium uppercase text-muted-soft">Operator</span>
                <p className="mt-1 truncate text-title-lg font-medium text-ink">{operator}</p>
              </div>
              <div className="text-right">
                <span className="text-caption-up font-medium uppercase text-muted-soft">Token expires in</span>
                <p
                  className={cx(
                    'mt-1 font-mono tnum text-metric-md',
                    secondsRemaining === null ? 'text-muted-soft' : expiringSoon ? 'text-error' : 'text-ink',
                  )}
                >
                  {secondsRemaining === null ? '--' : formatDuration(secondsRemaining)}
                </p>
              </div>
            </div>

            {expiringSoon && (
              <p className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-caption text-[#7a5c0d]">
                This session ends soon. Signing out and back in now avoids losing a teleop session mid-drive.
              </p>
            )}

            <Button variant="secondary" size="md" onClick={logout} className="mt-5">
              <SignOut size={16} />
              Log out
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <Plugs size={14} />
                Connection
              </span>
            }
          />
          <dl className="divide-y divide-hairline-soft px-5 py-2">
            <DataRow
              label="API base URL"
              value={apiBaseUrl === null ? <Skeleton className="inline-block h-3.5 w-40 align-middle" /> : apiBaseUrl}
              mono
            />
            <DataRow label="Teleop command rate" value="20 Hz, fixed" />
            <DataRow label="Fleet status feed" value="WebSocket, /ws/status" mono />
          </dl>
          <p className="border-t border-hairline-soft px-5 py-4 text-caption leading-relaxed text-muted">
            The API base URL is injected at container startup (see docs/02-docker-foundations.md), so the same
            built frontend works against any backend address without a rebuild.
          </p>
        </Panel>
      </div>

      <Panel className="bg-surface-soft">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-surface-card text-muted">
            <GearSix size={18} />
          </span>
          <p className="max-w-[70ch] text-body-sm text-muted">
            There are no operator preferences to save yet. This console has no per-user settings store on the
            backend, so everything on this page is read from the session and the runtime config rather than
            written back.
          </p>
        </div>
      </Panel>
    </div>
  )
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
