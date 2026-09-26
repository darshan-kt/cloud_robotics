/**
 * The shell wrapping every protected page (see App.tsx's route tree).
 *
 * Replaces the previous three-link top bar with a persistent rail,
 * because the console's real loop is fleet then robot then drive, and the
 * old shell dropped the fleet the moment you opened a robot: the only way
 * from one machine to another was back out to the dashboard. The rail
 * carries the live fleet, so an operator can move between robots without
 * leaving the one they are watching. Routes, slugs and nav labels are
 * unchanged.
 *
 * The status socket is mounted here rather than in Dashboard so the rail
 * and the pages share one connection, handed down through the router's
 * outlet context.
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { GearSix, List, Pulse, Robot as RobotIcon, SignOut, SquaresFour, X } from '@phosphor-icons/react'
import { useAuth } from '../auth/AuthContext'
import { useStatusSocket } from '../hooks/useStatusSocket'
import type { RobotSummary } from '../api/types'
import { Skeleton, cx } from './ui'
import { Wordmark } from './Brand'

export interface FleetContext {
  robots: RobotSummary[]
  connected: boolean
  hasLoaded: boolean
}

/** Read the shared fleet feed from any page under this shell. */
export function useFleet(): FleetContext {
  return useOutletContext<FleetContext>()
}

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: SquaresFour },
  { to: '/health', label: 'Health', icon: Pulse },
  { to: '/settings', label: 'Settings', icon: GearSix },
]

export function Layout() {
  const { operator, logout, token } = useAuth()
  const fleet = useStatusSocket(token)
  const [sheetOpen, setSheetOpen] = useState(false)
  const location = useLocation()

  // Navigating from inside the mobile sheet should close it, otherwise
  // the operator lands on the new page behind an open overlay.
  useEffect(() => setSheetOpen(false), [location.pathname])

  // Escape closes the sheet; matching what every other overlay does.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  return (
    <div className="min-h-[100dvh] bg-canvas text-body">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Below lg the rail becomes a sheet, so the bar carries the
          trigger. At lg and up the rail is always visible and this bar
          is gone entirely - no duplicated chrome. */}
      <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-hairline bg-canvas/90 px-4 backdrop-blur-sm lg:hidden">
        <Wordmark />
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-controls="nav-rail"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline text-ink transition-colors hover:bg-surface-card"
        >
          <List size={20} />
          <span className="sr-only">Open navigation</span>
        </button>
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          onClick={() => setSheetOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Rail
          fleet={fleet}
          operator={operator}
          onLogout={logout}
          sheetOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />

        <main id="main" className="min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
          <div className="mx-auto max-w-[76rem]">
            <Outlet context={fleet} />
          </div>
        </main>
      </div>
    </div>
  )
}

function Rail({
  fleet,
  operator,
  onLogout,
  sheetOpen,
  onClose,
}: {
  fleet: FleetContext
  operator: string | null
  onLogout: () => void
  sheetOpen: boolean
  onClose: () => void
}) {
  return (
    <nav
      id="nav-rail"
      aria-label="Console"
      className={cx(
        'flex w-[17rem] flex-col border-r border-hairline bg-surface-soft',
        // Mobile: an off-canvas sheet. Desktop: a sticky full-height rail.
        'fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-[100dvh] lg:translate-x-0',
        sheetOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between px-5 lg:h-auto lg:py-6">
        <Wordmark />
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-card hover:text-ink lg:hidden"
        >
          <X size={18} />
          <span className="sr-only">Close navigation</span>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-3 pb-4 scrollbar-slim">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-nav font-medium transition-colors',
                    isActive
                      ? 'bg-surface-strong text-ink'
                      : 'text-muted hover:bg-surface-card hover:text-body-strong',
                  )
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>

        <FleetRailSection fleet={fleet} />
      </div>

      <div className="shrink-0 border-t border-hairline px-5 py-4">
        <p className="text-caption-up font-medium uppercase text-muted-soft">Signed in</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-body-sm font-medium text-ink">{operator}</span>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium text-muted transition-colors hover:bg-surface-card hover:text-ink"
          >
            <SignOut size={15} />
            Log out
          </button>
        </div>
      </div>
    </nav>
  )
}

/** The live fleet, inline in the rail. Colour here is real state (a robot
 *  is reachable or it is not), and it is always paired with the status
 *  word in the title attribute and screen-reader text. */
function FleetRailSection({ fleet }: { fleet: FleetContext }) {
  const { robots, hasLoaded, connected } = fleet

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <h2 className="text-caption-up font-medium uppercase text-muted-soft">Robots</h2>
        <span className="font-mono tnum text-caption text-muted-soft">{hasLoaded ? robots.length : ''}</span>
      </div>

      {!hasLoaded ? (
        <div className="flex flex-col gap-1.5 px-3" aria-hidden="true">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-4/5 rounded-md" />
        </div>
      ) : robots.length === 0 ? (
        <p className="px-3 text-caption leading-relaxed text-muted-soft">
          {connected ? 'None reporting yet.' : 'Feed offline. Retrying.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {robots.map((robot) => (
            <li key={robot.robot_id}>
              <NavLink
                to={`/robots/${encodeURIComponent(robot.robot_id)}`}
                className={({ isActive }) =>
                  cx(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-body-sm transition-colors',
                    isActive
                      ? 'bg-surface-strong text-ink'
                      : 'text-body hover:bg-surface-card hover:text-ink',
                  )
                }
              >
                <span
                  className={cx(
                    'h-1.5 w-1.5 shrink-0 rounded-pill',
                    robot.status === 'online'
                      ? 'bg-success'
                      : robot.status === 'offline'
                        ? 'bg-error'
                        : 'bg-warning',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{robot.display_name || robot.robot_id}</span>
                <span className="sr-only">{robot.status}</span>
                {robot.in_use_by && <RobotIcon size={14} className="shrink-0 text-coral-active" aria-label="in use" />}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

