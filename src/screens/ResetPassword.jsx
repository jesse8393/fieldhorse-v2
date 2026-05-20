import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.ts'
import Aurora from '../components/fx/Aurora.jsx'
import GridPattern from '../components/fx/GridPattern.jsx'

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
    <div style={{ position: 'relative', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--surface-0)', color: 'var(--ink-strong)', overflow: 'hidden' }}>
      <Aurora />
      <GridPattern />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.14em', lineHeight: 1 }}>
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </div>
          <h1
            className="fh-font-serif"
            style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.02em', marginTop: 28, marginBottom: 8, fontWeight: 400 }}
          >
            Reset your
            <br />
            password.
          </h1>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 12,
              padding: '3px 10px',
              borderRadius: 999,
              background: ready ? 'rgba(201,150,58,0.12)' : 'var(--surface-2)',
              border: ready ? '1px solid rgba(201,150,58,0.3)' : '1px solid var(--rule)',
              color: ready ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase'
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: ready ? 'var(--field-gold-bright)' : 'var(--ink-muted)' }} />
            {ready ? 'Link verified' : 'Verifying'}
          </div>
        </div>

        {ready ? (
          <form
            onSubmit={onSubmit}
            noValidate
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 20,
              borderRadius: 18,
              background: 'var(--surface-2)',
              border: '1px solid var(--rule)',
              backdropFilter: 'blur(20px)'
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>New password</span>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }}
                />
              </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Confirm password</span>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }}
                />
              </div>
            </label>

            {error && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alert-red)', fontFamily: 'var(--font-body)' }}>{error}</p>
            )}
            {notice && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--signal-green)', fontFamily: 'var(--font-body)' }}>{notice}</p>
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
              {busy ? 'SAVING…' : (<>UPDATE PASSWORD<ArrowRight size={18} /></>)}
            </motion.button>
          </form>
        ) : (
          <div
            style={{
              padding: 20,
              borderRadius: 18,
              background: 'var(--surface-2)',
              border: '1px solid var(--rule)',
              backdropFilter: 'blur(20px)',
              fontSize: 13,
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-body)',
              textAlign: 'center'
            }}
          >
            If nothing happens, the link may have expired. Request a new reset from the sign-in page.
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate('/login', { replace: true })}
          style={{ marginTop: 12, width: '100%', background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'center' }}
        >
          Back to sign in
        </button>
      </motion.div>
    </div>
  )
}
