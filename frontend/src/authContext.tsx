/**
 * Administrator sign-in for the System view.
 *
 * The Public view needs no account. The System view asks for the one
 * administrator account; the backend returns a session token that `apiRequest`
 * sends on every request. The token is kept in sessionStorage, so closing the
 * tab signs out. A 401 from any System route also signs out, which covers an
 * expired session or a restarted backend.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { API_BASE_URL, getAuthToken, onUnauthorized, setAuthToken } from './api/client'

export type LoginOutcome = { ok: true } | { ok: false; message: string }

export type AuthContextValue = {
  signedIn: boolean
  login: (username: string, password: string) => Promise<LoginOutcome>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** The screen locks after this long without activity. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

/**
 * How often activity may refresh the backend's idle timer. The backend allows
 * `IDLE_SECONDS` = idle timeout + this interval (backend/app/routes/auth.py), so
 * the backend session always outlasts the screen lock.
 */
const KEEPALIVE_MS = 5 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(() => getAuthToken() !== null)

  // A 401 from a System route means the session is gone.
  useEffect(() => onUnauthorized(() => setSignedIn(false)), [])

  // Sign out after the backend's idle timeout with no activity, so an unattended
  // screen locks even though no request is made to discover the expiry.
  // Activity also refreshes the backend's idle timer, at most every few minutes,
  // so reading one page for a long time does not expire the backend session.
  useEffect(() => {
    if (!signedIn) return
    let timer = window.setTimeout(expire, IDLE_TIMEOUT_MS)
    let lastPing = Date.now()
    function expire() {
      setAuthToken(null)
      setSignedIn(false)
    }
    function reset() {
      window.clearTimeout(timer)
      timer = window.setTimeout(expire, IDLE_TIMEOUT_MS)
      const token = getAuthToken()
      if (token !== null && Date.now() - lastPing > KEEPALIVE_MS) {
        lastPing = Date.now()
        fetch(`${API_BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
          .then((response) => {
            if (response.status === 401 && getAuthToken() === token) expire()
          })
          .catch(() => {})
      }
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'mousemove'] as const
    events.forEach((name) => window.addEventListener(name, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((name) => window.removeEventListener(name, reset))
    }
  }, [signedIn])

  // Confirm a token restored from an earlier page load is still live.
  useEffect(() => {
    const token = getAuthToken()
    if (token === null) return
    fetch(`${API_BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (response.status === 401 && getAuthToken() === token) {
          setAuthToken(null)
          setSignedIn(false)
        }
      })
      .catch(() => {
        // Backend unreachable: keep the token; the pages show the network error.
      })
  }, [])

  const login = useCallback(async (username: string, password: string): Promise<LoginOutcome> => {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
    } catch {
      return { ok: false, message: 'The backend API could not be reached.' }
    }
    if (!response.ok) {
      return {
        ok: false,
        message: response.status === 401 ? 'Incorrect username or password.' : 'Sign-in failed. Try again.',
      }
    }
    const body = (await response.json()) as { data: { token: string } }
    setAuthToken(body.data.token)
    setSignedIn(true)
    return { ok: true }
  }, [])

  const logout = useCallback(() => {
    const token = getAuthToken()
    setAuthToken(null)
    setSignedIn(false)
    if (token !== null) {
      void fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {})
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({ signedIn, login, logout }), [signedIn, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)

  if (value === null) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }

  return value
}
