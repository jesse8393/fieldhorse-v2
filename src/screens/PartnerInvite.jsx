import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Users, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import Aurora from '../components/fx/Aurora.jsx'
import GridPattern from '../components/fx/GridPattern.jsx'

/**
 * PartnerInvite — landing page for /partner-invite/:token
 *
 * Flow (when fully wired, post-migration-004):
 *   1. Unauthenticated user clicks email link -> lands here
 *   2. We fetch invite details via /api/partner-invite-info?token=...
 *      (invoker name + company, job title, invited email)
 *   3. Two CTAs: [Sign in] (existing user) or [Create account]
 *   4. After auth, POST /api/partner-invite-accept?token=... which validates,
 *      flips fh_job_partners.status -> 'accepted', sets partner_user_id, then
 *      redirects to /jobs/:id for that shared job.
 *
 * Current state: UI shell only. The info fetch + accept-POST are stubbed and
 * will fail gracefully until the migration + Netlify functions are live.
 */
export default function PartnerInvite() {
  const { token } = useParams()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [info, setInfo] = useState(null)
  const [infoErr, setInfoErr] = useState('')
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`/api/partner-invite-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return
        if (data?.error) setInfoErr(friendlyError(data.error))
        else setInfo(data || {})
      })
      .catch(() => { if (!cancelled) setInfoErr('Invite lookup failed') })
    return () => { cancelled = true }
  }, [token])

  function friendlyError(code) {
    if (!code) return ''
    if (code === 'invite_not_found') return 'This invite link is invalid or was removed.'
    if (code === 'invite_revoked') return 'This invite was revoked by the sender.'
    if (code === 'email_mismatch') return 'Sign in with the email this invite was sent to.'
    if (code === 'not_authenticated' || code === 'invalid_token') return 'Please sign in to accept this invite.'
    return code
  }

  // If already signed in, auto-accept and redirect.
  useEffect(() => {
    if (loading || !session?.access_token || !token || accepting || infoErr) return
    setAccepting(true)
    fetch(`/api/partner-invite-accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ token })
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data?.job_id) navigate(`/jobs/${data.job_id}`, { replace: true })
        else setInfoErr(friendlyError(data?.error) || 'Could not accept invite')
      })
      .catch(() => setInfoErr('Accept failed'))
      .finally(() => setAccepting(false))
  }, [loading, session, token, accepting, infoErr, navigate])

  const inviterName = info?.inviter_name || info?.inviter_company || 'A contractor on Fieldhorse'
  const jobTitle = info?.job_title || 'a job'

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--surface-0)', color: 'var(--ink-strong)', overflow: 'hidden' }}>
      <Aurora />
      <GridPattern />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.14em', lineHeight: 1 }}>
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 20,
              padding: '3px 10px',
              borderRadius: 999,
              background: 'rgba(201,150,58,0.12)',
              border: '1px solid rgba(201,150,58,0.3)',
              color: 'var(--field-gold-bright)',
              fontFamily: 'var(--font-body)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase'
            }}
          >
            <Users size={11} />
            Partner invite
          </div>
          <h1
            className="fh-font-serif"
            style={{ fontSize: 'clamp(24px, 6.5vw, 32px)', lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 14, marginBottom: 6, fontWeight: 400 }}
          >
            {inviterName} invited you to{' '}
            <em className="fh-font-serif-italic fh-text-gradient-gold">co-manage.</em>
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
            You'll get access to <strong style={{ color: 'var(--ink-strong)' }}>{jobTitle}</strong> — notes, schedule, payments, subs, expenses. Nothing else from their account.
          </p>
        </div>

        {infoErr && (
          <div
            role="alert"
            style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, marginBottom: 14 }}
          >
            {infoErr}
          </div>
        )}

        {!session && !accepting && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 20,
              borderRadius: 18,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--rule)',
              backdropFilter: 'blur(20px)'
            }}
          >
            <Link
              to={`/login?partner_invite=${encodeURIComponent(token || '')}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 18px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                letterSpacing: '0.14em',
                textDecoration: 'none',
                boxShadow: '0 8px 24px rgba(201,150,58,0.35)'
              }}
            >
              SIGN IN
              <ArrowRight size={16} />
            </Link>
            <Link
              to={`/login?partner_invite=${encodeURIComponent(token || '')}&mode=signup`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 18px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--rule)',
                color: 'var(--ink-strong)',
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                letterSpacing: '0.14em',
                textDecoration: 'none'
              }}
            >
              CREATE ACCOUNT
            </Link>
          </div>
        )}

        {session && accepting && (
          <p style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>
            Linking you to the job…
          </p>
        )}
      </motion.div>
    </div>
  )
}
