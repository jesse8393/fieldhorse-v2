import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import Aurora from '../components/fx/Aurora.jsx'
import GridPattern from '../components/fx/GridPattern.jsx'

export default function Login() {
  const { signIn, signUp, sendPasswordReset, session, loading } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return null
  if (session) return <Navigate to="/" replace />

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
  const firstName = profile?.full_name?.trim().split(/\s+/)[0]
  const heroPrefix = firstName ? 'Welcome back,' : 'Welcome,'
  const heroName = firstName || 'operator'

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--surface-0)', color: 'var(--ink-strong)', overflow: 'hidden' }}>
      <Aurora />
      <GridPattern />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.14em', lineHeight: 1 }}>
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </div>
          <h1
            className="fh-font-serif"
            style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.02em', marginTop: 28, marginBottom: 0, fontWeight: 400 }}
          >
            {isSignIn ? heroPrefix : 'Sign up,'}
            <br />
            <em className="fh-font-serif-italic fh-text-gradient-gold">{isSignIn ? `${heroName}.` : 'operator.'}</em>
          </h1>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 20,
            borderRadius: 18,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--rule)',
            backdropFilter: 'blur(20px)'
          }}
        >
          <span
            style={{
              alignSelf: 'flex-start',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--field-gold-bright)',
              padding: '3px 10px',
              borderRadius: 999,
              background: 'rgba(201,150,58,0.1)',
              border: '1px solid rgba(201,150,58,0.2)'
            }}
          >
            {isSignIn ? 'Authenticate' : 'Provision account'}
          </span>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Email</span>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                placeholder="you@company.com"
                style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }}
              />
            </div>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Password</span>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
              <input
                type="password"
                required
                minLength={6}
                autoComplete={isSignIn ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                placeholder="••••••••"
                style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }}
              />
            </div>
          </label>

          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alert-red)', fontFamily: 'var(--font-body)' }}>
              {error}
            </p>
          )}
          {notice && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--signal-green)', fontFamily: 'var(--font-body)' }}>
              {notice}
            </p>
          )}

          <motion.button
            type="submit"
            disabled={busy}
            whileTap={{ scale: 0.98 }}
            style={{
              marginTop: 6,
              padding: '14px 18px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
              color: 'var(--onyx)',
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              letterSpacing: '0.15em',
              border: 'none',
              cursor: busy ? 'default' : 'pointer',
              boxShadow: '0 8px 24px rgba(201,150,58,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: busy ? 0.6 : 1
            }}
          >
            {busy
              ? (isSignIn ? 'SIGNING IN…' : 'CREATING…')
              : (<>{isSignIn ? 'SIGN IN' : 'CREATE ACCOUNT'}<ArrowRight size={18} /></>)}
          </motion.button>

          <button
            type="button"
            onClick={() => {
              setError('')
              setNotice('')
              setMode(isSignIn ? 'signup' : 'signin')
            }}
            disabled={busy}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'center' }}
          >
            {isSignIn ? 'New here? Create an account' : 'Already on Fieldhorse? Sign in'}
          </button>

          {isSignIn && (
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={busy}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'center' }}
            >
              Forgot password?
            </button>
          )}
        </form>
      </motion.div>
    </div>
  )
}
