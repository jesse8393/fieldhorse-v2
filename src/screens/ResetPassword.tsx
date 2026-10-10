import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { Button, Chip, Field } from '../components/fh'
import AuthShell from './auth/AuthShell.tsx'

// Reset password, on the same onyx stage as Login (spec 9.1).
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
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    supabase.auth.getSession().then(({ data }: any) => {
      if (data.session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
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
    } catch (err: any) {
      setError(err?.message || 'Could not update password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell labelledBy="fh-reset-title">
      <h1 id="fh-reset-title" className="fha-title">Reset your password.</h1>
      <div className="fha-chips">
        <Chip label={ready ? 'Link verified' : 'Verifying'} tone={ready ? 'success' : 'neutral'} dot />
      </div>

      {ready ? (
        <form className="fha-form" onSubmit={onSubmit} noValidate>
          <Field
            label="New password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="••••••••"
          />

          <Field
            label="Confirm password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            placeholder="••••••••"
          />

          {error && <p role="alert" className="fha-alert">{error}</p>}
          {notice && <p role="status" className="fha-notice">{notice}</p>}

          <div className="fha-actions">
            <Button type="submit" variant="primary" size="lg" block data-fha-primary loading={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="fha-note">
          If nothing happens, the link may have expired. Request a new reset from the sign in page.
        </p>
      )}

      <Button variant="quiet" size="md" block className="fha-back" onClick={() => navigate('/login', { replace: true })}>
        Back to sign in
      </Button>
    </AuthShell>
  )
}
