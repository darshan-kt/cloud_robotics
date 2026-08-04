/**
 * Auth state: current operator + JWT, persisted to localStorage so a page
 * refresh doesn't force a re-login. Deliberately simple - one shared
 * operator credential (see backend app/config.py), so there's no user
 * object beyond a username string and a token.
 *
 * Client-side expiry checking here is a UX nicety only (show the login
 * page proactively instead of waiting for a 401), not a security
 * boundary - the backend independently verifies every token on every
 * request (app/auth/dependencies.py). A tampered `expiresAt` in
 * localStorage can at most make this app _think_ it's logged in for
 * longer than it really is; the first API call would still 401 and
 * ApiClient.request's ApiError, once wired into logout-on-401 below,
 * catches that.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { login as apiLogin } from '../api/client'

const STORAGE_KEY = 'cloud-robotics.auth'

interface StoredAuth {
  token: string
  operator: string
  expiresAt: number // epoch ms
}

interface AuthContextValue {
  token: string | null
  operator: string | null
  expiresAt: number | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function loadStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredAuth
    if (!parsed.token || !parsed.expiresAt) return null
    if (Date.now() >= parsed.expiresAt) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadStoredAuth())

  // Passive session-expiry check - catches the "left the tab open past
  // token expiry" case without requiring a failed API call first.
  useEffect(() => {
    if (!auth) return
    const msRemaining = auth.expiresAt - Date.now()
    if (msRemaining <= 0) {
      setAuth(null)
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const timer = setTimeout(() => {
      setAuth(null)
      localStorage.removeItem(STORAGE_KEY)
    }, msRemaining)
    return () => clearTimeout(timer)
  }, [auth])

  const login = useCallback(async (username: string, password: string) => {
    const { access_token, expires_in } = await apiLogin(username, password)
    const next: StoredAuth = {
      token: access_token,
      operator: username,
      expiresAt: Date.now() + expires_in * 1000,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setAuth(next)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setAuth(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token: auth?.token ?? null,
      operator: auth?.operator ?? null,
      expiresAt: auth?.expiresAt ?? null,
      isAuthenticated: auth !== null,
      login,
      logout,
    }),
    [auth, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used within an <AuthProvider>')
  return ctx
}
