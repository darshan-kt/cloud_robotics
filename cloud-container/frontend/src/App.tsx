/** Route tree for the operator console (Milestone 9). The Milestone 2
 * "Backend connected?" stub this replaces is subsumed by the Health page
 * (src/pages/Health.tsx), which checks the same /health endpoint plus
 * real fleet metrics - see docs/09-frontend.md. */
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Health } from './pages/Health'
import { Login } from './pages/Login'
import { Robot } from './pages/Robot'
import { Settings } from './pages/Settings'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/robots/:robotId" element={<Robot />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/health" element={<Health />} />
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
