/** Route guard: redirects to /login (preserving the intended destination
 * in location state, so Login can send the operator back) when no valid
 * session exists. Wraps the router's <Outlet /> rather than each page
 * individually - see App.tsx. */
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
