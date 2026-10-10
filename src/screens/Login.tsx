import { type FormEvent, useState } from 'react'
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.tsx'
import { isSupabaseConfigured } from '../lib/supabase.ts'
import { safeNextPath } from '../lib/nextPath.ts'
import { Button, Field } from '../components/fh'
import AuthShell from './auth/AuthShell.tsx'

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

const MISSING_ENV = 'Local Supabase env is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then restart Vite.'

// Welcome and Login (spec 9.1, render glamor/g-welcome.jpg): the FIELDHORSE
// wordmark, the line, email and password, one brushed gold Sign in, an
// outlined Create a workspace that switches to sign up, a quiet Forgot
// password and the smoke line. The stage is always onyx (AuthShell).
export default function Login() {
  const { signIn, signUp, sendPasswordReset, session, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const partnerInviteToken = params.get('partner_invite') || ''
  // Where to land after auth, for example the org invite a signed out
  // teammate was trying to accept. Same origin paths only.
  const nextPath = safeNextPath(params.get('next'))
  const initialMode = params.get('mode') === 'signup' ? 'signup' : 'signin'
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // True the moment THIS form kicks off a signup. The session lands via
  // the auth subscription and re-renders Login BEFORE the async handler
  // reaches its navigate('/onboarding'), so the render-redirect below
  // used to win the race and bounce brand-new accounts through '/'
  // (a visible flash of the dashboard shell, then a second hop into
  // onboarding). With the flag, the very first post-signup render goes
  // straight to /onboarding. Login unmounts on navigation, so the flag
  // resets naturally for later visits.
  const [justSignedUp, setJustSignedUp] = useState(false)
  const controlsDisabled = busy
  const submitDisabled = !isSupabaseConfigured

  // After-auth destination: partner invite flow > ?next= > root.
  const afterAuthTarget = partnerInviteToken
    ? `/partner-invite/${partnerInviteToken}`
    : nextPath || '/'
  // A fresh signup with somewhere to be (an invite to accept) goes there
  // first, not to onboarding: accepting an org invite is what sets up an
  // invited teammate, and onboarding would make them a company of their own.
  const hasExplicitTarget = Boolean(partnerInviteToken || nextPath)

  // Reading the saved session: paint the stage, not the form, so a returning
  // person never sees it flash before the redirect below.
  if (loading) return <AuthShell labelledBy="fh-login-title" loading />
  if (session) {
    const dest = justSignedUp && !hasExplicitTarget ? '/onboarding' : afterAuthTarget
    return <Navigate to={dest} replace />
  }

  async function handleForgotPassword() {
    setError('')
    setNotice('')
    if (!isSupabaseConfigured) {
      setError(MISSING_ENV)
      return
    }
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
      setError(getErrorMessage(err, 'Could not send reset email.'))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setNotice('')
    if (!isSupabaseConfigured) {
      setError(MISSING_ENV)
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate(afterAuthTarget, { replace: true })
      } else {
        // Raise the flag BEFORE the call: the auth subscription can
        // re-render this component with a live session before this
        // handler resumes after the await.
        setJustSignedUp(true)
        // The confirmation link (when email confirmation is on) lands
        // back on the invite instead of the home page.
        const { data, error } = await signUp(email, password, hasExplicitTarget ? afterAuthTarget : undefined)
        if (error) throw error
        if (!data.session) {
          // Email-confirmation flow, no session yet, no redirect. The
          // ?next= stays in the URL for the sign in that follows.
          setJustSignedUp(false)
          setNotice('Check your email to confirm, then sign in.')
          setMode('signin')
        } else if (hasExplicitTarget) {
          navigate(afterAuthTarget, { replace: true })
        } else {
          navigate('/onboarding', { replace: true })
        }
      }
    } catch (err) {
      setJustSignedUp(false)
      setError(getErrorMessage(err, 'Authentication failed'))
    } finally {
      setBusy(false)
    }
  }

  const isSignIn = mode === 'signin'

  return (
    <AuthShell labelledBy="fh-login-title">
      <h1 id="fh-login-title" className="fha-line">Run every job like a captain.</h1>

      <form className="fha-form" onSubmit={onSubmit} noValidate>
        {!isSupabaseConfigured && (
          <p role="alert" className="fha-alert">{MISSING_ENV}</p>
        )}

        <Field
          label="Email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={controlsDisabled}
          placeholder="you@company.com"
        />

        <Field
          label="Password"
          type="password"
          required
          minLength={6}
          autoComplete={isSignIn ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={controlsDisabled}
          placeholder="••••••••"
        />

        {error && <p role="alert" className="fha-alert">{error}</p>}
        {/* Screen readers announce the notice (reset link sent, confirm
            your email) from this region. It stays mounted, because a
            live region added together with its text is often skipped. */}
        <p role="status" className="fhc-vh">{notice}</p>
        {notice && <p aria-hidden="true" className="fha-notice">{notice}</p>}

        <div className="fha-actions">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            data-fha-primary
            disabled={submitDisabled}
            loading={busy}
          >
            {!isSupabaseConfigured
              ? 'Add Supabase env'
              : busy
                ? (isSignIn ? 'Signing in…' : 'Creating account…')
                : (isSignIn ? 'Sign in' : 'Create account')}
          </Button>

          <Button
            variant="secondary"
            size="lg"
            block
            disabled={controlsDisabled}
            onClick={() => {
              setError('')
              setNotice('')
              setMode(isSignIn ? 'signup' : 'signin')
            }}
          >
            {isSignIn ? 'Create a workspace' : 'Already have an account? Sign in'}
          </Button>
        </div>

        {isSignIn && (
          <Button variant="quiet" size="md" block disabled={controlsDisabled} onClick={handleForgotPassword}>
            Forgot password?
          </Button>
        )}
      </form>

      <p className="fha-smoke">Bring your jobs over from Jobber in a few minutes.</p>
    </AuthShell>
  )
}
