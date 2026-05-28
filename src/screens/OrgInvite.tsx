// OrgInvite — /invite/:token landing.
//
// Mirrors the /partner-invite/:token flow. Public route (no auth
// required to LOAD the page; the user is bounced to /login if they
// hit Accept while signed out). Calls org-invite-info to render a
// preview banner; the operator clicks Accept, the screen calls
// org-invite-accept and routes to / on success.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { orgInviteAccept, orgInviteInfo, type OrgInviteInfo } from '../lib/orgApi.ts'

type Phase =
  | 'loading'
  | 'preview'
  | 'accepting'
  | 'accepted'
  | 'sign_in_required'
  | 'expired'
  | 'mismatch'
  | 'not_found'
  | 'error'

export default function OrgInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, session } = useAuth()
  const { refresh } = useMembership()

  const [phase, setPhase] = useState<Phase>('loading')
  const [invite, setInvite] = useState<OrgInviteInfo | null>(null)
  const [errMsg, setErrMsg] = useState<string>('')

  // 1. Fetch the invite preview on mount.
  useEffect(() => {
    let cancelled = false
    if (!token) { setPhase('not_found'); return }
    orgInviteInfo(token)
      .then((res) => {
        if (cancelled) return
        setInvite(res.invite)
        if (res.invite.expired) setPhase('expired')
        else if (res.invite.accepted) setPhase('accepted')
        else setPhase('preview')
      })
      .catch((e: any) => {
        if (cancelled) return
        if (e?.status === 404) setPhase('not_found')
        else { setPhase('error'); setErrMsg(e?.message || 'Could not load invite.') }
      })
    return () => { cancelled = true }
  }, [token])

  async function handleAccept() {
    if (!token) return
    if (!user || !session) { setPhase('sign_in_required'); return }
    setPhase('accepting')
    try {
      await orgInviteAccept(token)
      await refresh()
      setPhase('accepted')
      // Tiny pause so the user sees the success state before the redirect.
      window.setTimeout(() => navigate('/', { replace: true }), 800)
    } catch (e: any) {
      if (e?.status === 403 && e?.message === 'email_mismatch') setPhase('mismatch')
      else if (e?.status === 410) setPhase('expired')
      else { setPhase('error'); setErrMsg(e?.detail || e?.message || 'Accept failed.') }
    }
  }

  return (
    <div className="fh-build-page" data-build-screen="OrgInvite" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <main style={{ width: '100%', maxWidth: 460, padding: '40px 28px' }}>
        <div className="fh-build-card" style={{ padding: 28 }}>
          <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary, #c9963a)' }}>
            Team invite
          </div>

          {phase === 'loading' && (
            <h1 style={titleStyle}>Loading…</h1>
          )}

          {phase === 'not_found' && (
            <>
              <h1 style={titleStyle}>Invite not found</h1>
              <p style={pStyle}>This invite link is invalid or has been revoked.</p>
              <PrimaryBtn onClick={() => navigate('/')}>Go home</PrimaryBtn>
            </>
          )}

          {phase === 'expired' && (
            <>
              <h1 style={titleStyle}>Invite expired</h1>
              <p style={pStyle}>
                Ask {invite?.inviter_name || 'whoever sent this'} to send a fresh invite.
              </p>
              <PrimaryBtn onClick={() => navigate('/')}>Go home</PrimaryBtn>
            </>
          )}

          {phase === 'mismatch' && (
            <>
              <h1 style={titleStyle}>Wrong account</h1>
              <p style={pStyle}>
                This invite was issued to <strong style={hiStyle}>{invite?.email}</strong> but
                you're signed in as <strong style={hiStyle}>{user?.email}</strong>. Sign out
                and sign in with the invited address.
              </p>
              <PrimaryBtn onClick={() => navigate('/login')}>Switch account</PrimaryBtn>
            </>
          )}

          {phase === 'sign_in_required' && (
            <>
              <h1 style={titleStyle}>Sign in to accept</h1>
              <p style={pStyle}>
                This invite was issued to <strong style={hiStyle}>{invite?.email}</strong>.
                Sign in with that email to join.
              </p>
              <PrimaryBtn onClick={() => navigate(`/login?next=/invite/${token}`)}>Sign in</PrimaryBtn>
            </>
          )}

          {phase === 'preview' && invite && (
            <>
              <h1 style={titleStyle}>
                Join {invite.org_name || 'the team'}
              </h1>
              <p style={pStyle}>
                {invite.inviter_name ? `${invite.inviter_name} invited` : 'You were invited'}
                {' '}<strong style={hiStyle}>{invite.email}</strong> to join as a{' '}
                <strong style={hiStyle}>{invite.role}</strong>.
              </p>
              <PrimaryBtn onClick={handleAccept}>Accept invite</PrimaryBtn>
              <button type="button" onClick={() => navigate('/')} style={secondaryBtnStyle}>
                Not now
              </button>
            </>
          )}

          {phase === 'accepting' && (
            <>
              <h1 style={titleStyle}>Joining…</h1>
              <p style={pStyle}>One moment.</p>
            </>
          )}

          {phase === 'accepted' && (
            <>
              <h1 style={titleStyle}>You're in.</h1>
              <p style={pStyle}>
                Welcome to {invite?.org_name || 'the team'}. Redirecting…
              </p>
            </>
          )}

          {phase === 'error' && (
            <>
              <h1 style={titleStyle}>Something went wrong</h1>
              <p style={pStyle}>{errMsg || 'Try again or contact your team admin.'}</p>
              <PrimaryBtn onClick={() => navigate('/')}>Go home</PrimaryBtn>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', marginTop: 18,
        padding: '12px 16px',
        borderRadius: 8,
        background: 'var(--v3-primary, #c9963a)',
        color: '#0c0d0f',
        border: 'none',
        fontFamily: 'var(--font-body, "DM Sans", system-ui, sans-serif)',
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: '.04em',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const titleStyle: React.CSSProperties = {
  margin: '10px 0 8px',
  fontFamily: 'var(--font-display, "Bebas Neue", Impact, sans-serif)',
  fontSize: 32,
  letterSpacing: '.005em',
  color: '#f4f1ea',
  lineHeight: 1.1,
}

const pStyle: React.CSSProperties = {
  margin: 0,
  color: 'rgba(245,242,234,.78)',
  fontSize: 14,
  lineHeight: 1.55,
}

const hiStyle: React.CSSProperties = { color: '#f4f1ea', fontWeight: 700 }

const secondaryBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 8,
  padding: '10px 16px',
  borderRadius: 8,
  background: 'transparent',
  color: 'rgba(245,242,234,.55)',
  border: '1px solid rgba(255,255,255,.12)',
  fontFamily: 'var(--font-body, "DM Sans", system-ui, sans-serif)',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}
