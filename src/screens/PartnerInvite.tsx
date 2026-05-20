import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { Users, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import Aurora from '../components/fx/Aurora.tsx'
import GridPattern from '../components/fx/GridPattern.tsx'

function friendlyError(code: any) {
  if (!code) return ''
  if (code === 'invite_not_found') return 'This invite link is invalid or was removed.'
  if (code === 'invite_revoked') return 'This invite was revoked by the sender.'
  if (code === 'email_mismatch') return 'Sign in with the email this invite was sent to.'
  if (code === 'not_authenticated' || code === 'invalid_token') return 'Please sign in to accept this invite.'
  // Unknown non-empty backend code — surface a safe generic message
  // instead of leaking the raw identifier (lookup_failed, accept_failed,
  // server_misconfigured, etc.) into the UI.
  return "We couldn't accept this invite. Try again."
}

function isFatalError(msg: any) {
  if (!msg) return false
  const lower = msg.toLowerCase()
  return lower.includes('invalid') || lower.includes('revoked')
}

/**
 * PartnerInvite — landing page for /partner-invite/:token
 *
 * Hard requirements (Phase 15.3):
 * - Route is PUBLIC (App.jsx).
 * - Paints hero + a CTA zone on the FIRST frame, regardless of auth state,
 *   info-fetch state, or StrictMode double-invocation. No opacity-0 wrapper,
 *   no conditional that could hide the entire shell, no reliance on
 *   framer-motion to animate opacity from 0.
 * - If anything below throws, AppErrorBoundary in main.jsx catches it.
 */
export default function PartnerInvite() {
  const { token } = useParams()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [info, setInfo] = useState<any>(null)
  const [infoErr, setInfoErr] = useState('')
  const [accepting, setAccepting] = useState(false)
  // Ref-tracked "have we already started the accept call" guard.
  // Using state for this caused a cleanup-cancel cascade: putting
  // `accepting` in the effect's deps meant setAccepting(true) re-ran
  // the effect, which fired its cleanup (cancelled = true), which made
  // the in-flight fetch's .then/.finally no-op out. End result: spinner
  // stuck on "Linking you to the job…" forever even after the network
  // returned a successful job_id. A ref does not re-trigger the effect.
  const acceptStartedRef = useRef(false)

  useEffect(() => {
    if (!token) {
      setInfoErr(friendlyError('invite_not_found'))
      return
    }
    let cancelled = false
    fetch(`/api/partner-invite-info?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return
        if (data?.error) setInfoErr(friendlyError(data.error))
        else setInfo(data || {})
      })
      .catch((err) => {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.error('[partner-invite] info fetch failed', err)
        setInfoErr("We couldn't load this invite. Check your connection and try again.")
      })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (loading) return
    if (!session?.access_token) return
    if (!token) return
    if (acceptStartedRef.current) return
    if (isFatalError(infoErr)) return

    acceptStartedRef.current = true
    let cancelled = false
    setAccepting(true)

    // Hard timeout safety net. If the accept call never resolves (DNS,
    // proxy, function cold-start beyond Netlify's limit, etc.) we surface
    // a real error instead of leaving the user staring at the spinner
    // indefinitely. 15s is comfortably above a normal Netlify cold start.
    const timeoutId = setTimeout(() => {
      if (cancelled) return
      setInfoErr("This is taking longer than expected. Refresh the page to try again.")
      setAccepting(false)
    }, 15000)

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
        if (cancelled) return
        clearTimeout(timeoutId)
        if (data?.job_id) {
          navigate(`/jobs/${data.job_id}`, { replace: true })
        } else {
          setInfoErr(friendlyError(data?.error) || "We couldn't accept this invite. Try again.")
          setAccepting(false)
          // Allow the user to retry on next render (e.g., after they
          // refresh or the underlying state changes).
          acceptStartedRef.current = false
        }
      })
      .catch((err) => {
        if (cancelled) return
        clearTimeout(timeoutId)
        // eslint-disable-next-line no-console
        console.error('[partner-invite] accept failed', err)
        setInfoErr("We couldn't reach the server. Check your connection and try again.")
        setAccepting(false)
        acceptStartedRef.current = false
      })
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      // Reset the ref so a re-run of this effect (e.g. Supabase fires
      // TOKEN_REFRESHED and AuthContext emits a new session reference
      // mid-fetch) can start a fresh accept call instead of early-
      // returning past the guard. Without this, a session refresh
      // during the fetch would: cancel the in-flight handlers, leave
      // acceptStartedRef = true, and leave accepting = true forever
      // — same "stuck spinner" dead end the original bug had.
      acceptStartedRef.current = false
    }
    // Intentionally exclude `accepting` and `infoErr` from deps — they're
    // updated INSIDE this effect and including them would re-trigger the
    // cleanup cancel cascade. Auth + token + navigate are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, token, navigate])

  const inviterName = info?.inviter_company || info?.inviter_name || 'A contractor on Fieldhorse'
  const jobTitle = info?.job_title || 'a job'
  const fatal = isFatalError(infoErr)
  const showFatal = fatal
  // Sign-in block shows for any non-fatal, non-accepting state where we
  // know the user isn't signed in. Auth-loading intentionally still shows
  // the buttons — the Sign In button goes to /login which handles the
  // loading itself. Paint-something > paint-nothing.
  const showSignIn = !session && !accepting && !fatal
  const showLinking = !!session && accepting && !fatal
  const showSoftError = !fatal && infoErr && !showSignIn && !showLinking

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--surface-0, #141414)',
        color: 'var(--ink-strong, #f4f1ea)',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}
    >
      <Aurora />
      <GridPattern />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, opacity: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--font-display, "Bebas Neue", sans-serif)', fontSize: 36, letterSpacing: '0.14em', lineHeight: 1 }}>
            <span style={{ color: 'var(--field-gold, #c9963a)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong, #f4f1ea)' }}>HORSE</span>
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
              color: 'var(--field-gold-bright, #e8b04c)',
              fontFamily: 'var(--font-body, "DM Sans", sans-serif)',
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
            style={{ fontSize: 'clamp(24px, 6.5vw, 32px)', lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 14, marginBottom: 6, fontWeight: 400, color: 'var(--ink-strong, #f4f1ea)' }}
          >
            {inviterName} invited you to{' '}
            co-manage.
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-muted, #8a8577)', lineHeight: 1.5, fontFamily: 'var(--font-body, "DM Sans", sans-serif)' }}>
            You'll get access to <strong style={{ color: 'var(--ink-strong, #f4f1ea)' }}>{jobTitle}</strong> — notes, schedule, payments, subs, expenses. Nothing else from their account.
          </p>
        </div>

        {showFatal && (
          <div
            role="alert"
            style={{ padding: '14px 16px', borderRadius: 14, background: 'rgba(192,57,43,0.10)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red, #c0392b)', fontFamily: 'var(--font-body, "DM Sans", sans-serif)', fontSize: 14, fontWeight: 600, textAlign: 'center' }}
          >
            {infoErr}
          </div>
        )}

        {showSoftError && (
          <div
            role="alert"
            style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', color: 'var(--alert-red, #c0392b)', fontFamily: 'var(--font-body, "DM Sans", sans-serif)', fontSize: 13, fontWeight: 600, marginBottom: 14 }}
          >
            {infoErr}
          </div>
        )}

        {showSignIn && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 20,
              borderRadius: 18,
              background: 'var(--surface-2)',
              border: '1px solid var(--rule, rgba(255,255,255,0.08))'
            }}
          >
            {loading && (
              <p style={{ margin: '0 0 4px', textAlign: 'center', fontSize: 11, color: 'var(--ink-muted, #8a8577)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                Checking session…
              </p>
            )}
            <Link
              to={`/login?partner_invite=${encodeURIComponent(token || '')}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 18px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--field-gold-bright, #e8b04c), var(--field-gold-deep, #8c6f30))',
                color: 'var(--onyx, #141414)',
                fontFamily: 'var(--font-display, "Bebas Neue", sans-serif)',
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
                background: 'var(--surface-2)',
                border: '1px solid var(--rule, rgba(255,255,255,0.08))',
                color: 'var(--ink-strong, #f4f1ea)',
                fontFamily: 'var(--font-display, "Bebas Neue", sans-serif)',
                fontSize: 14,
                letterSpacing: '0.14em',
                textDecoration: 'none'
              }}
            >
              CREATE ACCOUNT
            </Link>
          </div>
        )}

        {showLinking && (
          <p style={{ textAlign: 'center', fontFamily: 'var(--font-body, "DM Sans", sans-serif)', fontSize: 13, color: 'var(--ink-muted, #8a8577)' }}>
            Linking you to the job…
          </p>
        )}
      </div>
    </div>
  )
}
