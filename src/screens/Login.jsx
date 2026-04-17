import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import Wordmark from '../components/Wordmark.jsx'

export default function Login() {
  const { signIn, signUp, sendPasswordReset, session, loading } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleForgotPassword() {
    setError('')
    setNotice('')
    if (!email) {
      setError('Enter your email above first, then hit Forgot password.')
      return
    }
    setBusy(true)
    try {
      const { error } = await sendPasswordReset(email)
      if (error) throw error
      setNotice('Reset link sent. Check your email.')
    } catch (err) {
      setError(err?.message || 'Could not send reset email.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null
  if (session) return <Navigate to="/" replace />

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate('/', { replace: true })
      } else {
        const { data, error } = await signUp(email, password)
        if (error) throw error
        if (!data.session) {
          setNotice('Check your email to confirm, then sign in.')
          setMode('signin')
        } else {
          navigate('/onboarding', { replace: true })
        }
      }
    } catch (err) {
      setError(err?.message || 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  const isSignIn = mode === 'signin'

  return (
    <main className="fh-auth">
      <div className="fh-auth__stack">
        <div className="fh-auth__stampline">
          <Wordmark size="3rem" tagline />
          <span className="fh-status-pill fh-status-pill--gold">Secure link</span>
        </div>

        <header className="fh-auth__head">
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">{isSignIn ? 'Authenticate' : 'Provision account'}</span>
          </span>
          <h1 className="fh-auth__title">
            {isSignIn ? 'Sign in' : 'Create account'}
          </h1>
          <p className="fh-auth__sub">
            {isSignIn
              ? 'Your rig. Your bids. Your numbers.'
              : 'Built for the jobsite.'}
          </p>
        </header>

        <form className="fh-auth__form" onSubmit={onSubmit} noValidate>
          <label className="fh-field">
            <span className="fh-field__label">Email</span>
            <input
              className="fh-field__input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="fh-field">
            <span className="fh-field__label">Password</span>
            <input
              className="fh-field__input"
              type="password"
              autoComplete={isSignIn ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {busy
              ? (isSignIn ? 'Signing in…' : 'Creating…')
              : (isSignIn ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <button
          className="fh-auth__toggle"
          type="button"
          onClick={() => {
            setError('')
            setNotice('')
            setMode(isSignIn ? 'signup' : 'signin')
          }}
          disabled={busy}
        >
          {isSignIn
            ? 'New here? Create an account'
            : 'Already on Fieldhorse? Sign in'}
        </button>

        {isSignIn && (
          <button
            className="fh-auth__forgot"
            type="button"
            onClick={handleForgotPassword}
            disabled={busy}
          >
            Forgot password?
          </button>
        )}
      </div>
    </main>
  )
}
