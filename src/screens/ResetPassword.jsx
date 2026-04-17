import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import Wordmark from '../components/Wordmark.jsx'

export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Supabase emits PASSWORD_RECOVERY when the reset link is opened
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true)
      }
    })
    // Also handle the hash-based token in the URL (older style)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const { error } = await updatePassword(password)
      if (error) throw error
      setNotice('Password updated. Redirecting…')
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      setError(err?.message || 'Could not update password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="fh-auth">
      <div className="fh-auth__stack">
        <div className="fh-auth__stampline">
          <Wordmark size="3rem" tagline />
          <span className={`fh-status-pill ${ready ? 'fh-status-pill--gold' : 'fh-status-pill--steel'}`}>
            {ready ? 'Link verified' : 'Verifying'}
          </span>
        </div>

        <header className="fh-auth__head">
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__num">§ 01 / 01</span>
            <span className="fh-sec-tag__label">Password reset</span>
          </span>
          <h1 className="fh-auth__title">Set a new password</h1>
          <p className="fh-auth__sub">
            {ready
              ? 'Pick something strong. Jobsite-ready.'
              : 'Verifying reset link…'}
          </p>
        </header>

        {ready && (
          <form className="fh-auth__form" onSubmit={onSubmit} noValidate>
            <label className="fh-field">
              <span className="fh-field__label">New password</span>
              <input
                className="fh-field__input"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>

            <label className="fh-field">
              <span className="fh-field__label">Confirm password</span>
              <input
                className="fh-field__input"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
            </label>

            {error && <p className="fh-auth__error" role="alert">{error}</p>}
            {notice && <p className="fh-auth__notice">{notice}</p>}

            <button
              className="fh-btn fh-btn--primary"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}

        {!ready && (
          <p className="fh-auth__notice">
            If nothing happens, the link may have expired. Request a new reset
            from the sign-in page.
          </p>
        )}

        <button
          className="fh-auth__toggle"
          type="button"
          onClick={() => navigate('/login', { replace: true })}
        >
          Back to sign in
        </button>
      </div>
    </main>
  )
}
