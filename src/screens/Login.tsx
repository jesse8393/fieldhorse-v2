import { type FormEvent, useState } from 'react'
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { isSupabaseConfigured } from '../lib/supabase.ts'

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export default function Login() {
  const { signIn, signUp, sendPasswordReset, session, loading } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const partnerInviteToken = params.get('partner_invite') || ''
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
  const submitDisabled = busy || !isSupabaseConfigured

  // After-auth destination: partner invite flow > root.
  const afterAuthTarget = partnerInviteToken
    ? `/partner-invite/${partnerInviteToken}`
    : '/'

  if (loading) return null
  if (session) {
    const dest = justSignedUp && !partnerInviteToken ? '/onboarding' : afterAuthTarget
    return <Navigate to={dest} replace />
  }

  async function handleForgotPassword() {
    setError('')
    setNotice('')
    if (!isSupabaseConfigured) {
      setError('Local Supabase env is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then restart Vite.')
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
      setError('Local Supabase env is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then restart Vite.')
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
        const { data, error } = await signUp(email, password)
        if (error) throw error
        if (!data.session) {
          // Email-confirmation flow, no session yet, no redirect.
          setJustSignedUp(false)
          setNotice('Check your email to confirm, then sign in.')
          setMode('signin')
        } else if (partnerInviteToken) {
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
  const firstName = profile?.full_name?.trim().split(/\s+/)[0]
  // Voice: premium business owner, not field operator. "Welcome back."
  // for returning users, "Built for builders." for new accounts. Once
  // the profile name is known we personalize the sign in line.
  const headline = isSignIn
    ? (firstName ? `Welcome back, ${firstName}.` : 'Welcome back.')
    : 'Built for builders.'
  const subline = isSignIn
    ? 'Run your business with clarity.'
    : 'Manage jobs, clients, and revenue in one place.'

  return (
    <main
      className="fh-auth-screen"
      aria-labelledby="fh-login-title"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--v3-bg)',
        color: 'var(--v3-text)',
        overflow: 'hidden'
      }}
    >
      {/* Subtle warm radial behind the card, not aurora, not grid. Just
          a single soft gold halo to add depth without atmosphere. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(201, 150, 58, 0.06), transparent 70%)'
        }}
      />

      <motion.div
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: 0, lineHeight: 1 }}>
            <span style={{ color: 'var(--v3-primary)' }}>FIELD</span>
            <span style={{ color: 'var(--v3-text)' }}>HORSE</span>
          </div>
          <h1
            id="fh-login-title"
            className="v3-h1"
            style={{ fontSize: 24, marginTop: 24, lineHeight: 1.15 }}
          >
            {headline}
          </h1>
          <p
            className="v3-caption"
            style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45 }}
          >
            {subline}
          </p>
        </div>

        {/* Card, v3 surface + premium gold top-edge stroke */}
        <form
          onSubmit={onSubmit}
          noValidate
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 24,
            borderRadius: 10,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-border-strong)',
            boxShadow: '0 1px 0 var(--v3-border-mid) inset, 0 4px 14px rgba(20, 20, 20, 0.30), 0 16px 40px rgba(20, 20, 20, 0.32)',
            overflow: 'hidden'
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: '14%',
              right: '14%',
              height: 1,
              background: 'linear-gradient(90deg, transparent 0%, rgba(201, 150, 58, 0.55) 50%, transparent 100%)',
              pointerEvents: 'none'
            }}
          />

          {!isSupabaseConfigured && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--v3-danger-bright)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
              Local Supabase env is missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then restart Vite.
            </p>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="v3-eyebrow fh-auth-label" style={{ color: 'var(--v3-text)', opacity: 1 }}>Email</span>
            <div style={{ position: 'relative' }}>
              <Mail size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
              <input
                className="fh-auth-input"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={controlsDisabled}
                placeholder="you@company.com"
                style={{
                  width: '100%',
                  padding: '12px 12px 12px 32px',
                  borderRadius: 10,
                  background: '#141414',
                  border: '1px solid var(--v3-border-strong)',
                  color: 'var(--v3-text)',
                  fontSize: 14,
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="v3-eyebrow fh-auth-label" style={{ color: 'var(--v3-text)', opacity: 1 }}>Password</span>
            <div style={{ position: 'relative' }}>
              <Lock size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--v3-text-muted)', pointerEvents: 'none' }} />
              <input
                className="fh-auth-input"
                type="password"
                required
                minLength={6}
                autoComplete={isSignIn ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={controlsDisabled}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '12px 12px 12px 32px',
                  borderRadius: 10,
                  background: '#141414',
                  border: '1px solid var(--v3-border-strong)',
                  color: 'var(--v3-text)',
                  fontSize: 14,
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </label>

          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--v3-danger-bright)', fontFamily: 'var(--font-body)' }}>
              {error}
            </p>
          )}
          {notice && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--v3-success-bright)', fontFamily: 'var(--font-body)' }}>
              {notice}
            </p>
          )}

          <motion.button
            type="submit"
            disabled={submitDisabled}
            whileTap={{ scale: 0.98 }}
            style={{
              marginTop: 6,
              padding: '12px 16px',
              borderRadius: 10,
              background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
              color: 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0,
              border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
              cursor: submitDisabled ? 'default' : 'pointer',
              boxShadow: '0 0 0 3px rgba(201, 150, 58, 0.16), 0 6px 18px rgba(201, 150, 58, 0.32), 0 1px 0 var(--v3-border-strong) inset',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 48,
              opacity: submitDisabled ? 0.72 : 1
            }}
          >
            {!isSupabaseConfigured
              ? 'Add Supabase env'
              : busy
                ? (isSignIn ? 'Signing in…' : 'Creating account…')
                : (<>{isSignIn ? 'Sign in' : 'Create account'}<ArrowRight size={16} /></>)}
          </motion.button>

          <button
            type="button"
            className="fh-auth-link-btn"
            onClick={() => {
              setError('')
              setNotice('')
              setMode(isSignIn ? 'signup' : 'signin')
            }}
            disabled={controlsDisabled}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, fontSize: 12, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'center', opacity: 1 }}
          >
            {isSignIn ? 'New to Fieldhorse? Create an account' : 'Already have an account? Sign in'}
          </button>

          {isSignIn && (
            <button
              type="button"
              className="fh-auth-link-btn"
              onClick={handleForgotPassword}
              disabled={controlsDisabled}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'center', opacity: 1 }}
            >
              Forgot password?
            </button>
          )}
        </form>
      </motion.div>
    </main>
  )
}
