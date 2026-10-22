/**
 * Shown in place of any System view page until the administrator signs in.
 * After signing in, the page that was requested renders in its place.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../authContext'
import { InlineError, Panel } from '../components/ui'

export default function AdminLoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const outcome = await login(username.trim(), password)
    setBusy(false)
    if (!outcome.ok) {
      setError(outcome.message)
      setPassword('')
    }
  }

  return (
    <div className="admin-login">
      <Panel title="Administrator sign-in">
        <form className="form-fields" onSubmit={submit}>
          <p className="field-hint">The System view changes the databases directly, so it is limited to the administrator.</p>
          {error && <InlineError compact>{error}</InlineError>}
          <label className="field">
            <span className="field-label">Username</span>
            <input
              className="input"
              autoComplete="username"
              autoFocus
              required
              maxLength={100}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              maxLength={200}
              aria-invalid={error ? true : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </Panel>
    </div>
  )
}
