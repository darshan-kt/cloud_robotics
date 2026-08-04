/** Nav shell wrapping every protected page (see App.tsx's route tree) -
 * fleet name, page links, current operator, logout. */
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
  }`

export function Layout() {
  const { operator, logout } = useAuth()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-semibold tracking-tight">Cloud Robotics Console</span>
            <nav className="flex items-center gap-1">
              <NavLink to="/dashboard" className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/health" className={navLinkClass}>
                Health
              </NavLink>
              <NavLink to="/settings" className={navLinkClass}>
                Settings
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400">
              Signed in as <span className="text-slate-200 font-medium">{operator}</span>
            </span>
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
