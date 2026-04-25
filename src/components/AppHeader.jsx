import { useNavigate } from 'react-router-dom'
import { NotebookPen } from 'lucide-react'
import { useProfile } from '../contexts/ProfileContext.jsx'
import FieldhorseBadge from './FieldhorseBadge.jsx'

/**
 * AppHeader — the shared top bar.
 *
 * Layout:
 *   [FH badge] · · · [USER COMPANY LOGO / NAME centered] · · · [Notes shortcut]
 *
 * Fallback chain for center slot:
 *   1. profile.logo_url     -> <img>
 *   2. profile.company_name -> Bebas Neue, Field Gold tint
 *   3. profile.full_name    -> Bebas Neue, white
 *   4. (everything blank)   -> FIELDHORSE wordmark
 *
 * Partner view: always renders THIS user's brand (not the inviter's).
 * Shared-job content is shared; chrome is not.
 *
 * Phase 18.1: right slot swapped from Bell + red-dot notification stub
 * to a plain Notes shortcut. Notes moved out of BottomNav; header becomes
 * the jump point. No unread badge until a real notifications system
 * backs it.
 */
export default function AppHeader() {
  const { profile } = useProfile()
  const navigate = useNavigate()

  const logoSrc = profile?.logo_url
  const company = profile?.company_name?.trim()
  const fullName = profile?.full_name?.trim()

  return (
    <header
      className="fh-app-header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '22px 20px 18px',
        paddingTop: 'calc(22px + env(safe-area-inset-top, 0px))',
        minHeight: 108,
        background: 'linear-gradient(180deg, rgba(20,20,20,0.88) 0%, rgba(20,20,20,0.72) 82%, rgba(20,20,20,0) 100%)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        pointerEvents: 'auto'
      }}
    >
      <FieldhorseBadge />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6
        }}
      >
        <BrandSlot logoSrc={logoSrc} company={company} fullName={fullName} />
      </div>

      <button
        type="button"
        aria-label="Notes"
        onClick={() => navigate('/notes')}
        className="fh-header-notes-btn"
        style={{
          width: 44,
          height: 44,
          minWidth: 44,
          borderRadius: 11,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--rule)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ink-strong)',
          cursor: 'pointer',
          padding: 0,
          transition: 'color 160ms ease, background 160ms ease, border-color 160ms ease'
        }}
      >
        <NotebookPen size={16} />
      </button>
    </header>
  )
}

function BrandSlot({ logoSrc, company, fullName }) {
  // Logo should be the dominant visual. clamp scales between iPhone SE
  // (~72px) and desktop (~96px) without any breakpoint CSS.
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={company || 'Company logo'}
        style={{
          maxHeight: 'clamp(46px, 7vw, 62px)',
          maxWidth: 'min(60vw, 380px)',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          display: 'block'
        }}
        onError={(e) => {
          // If the signed URL expired or 403s, hide the img and let the
          // fallback text be visible on next render. We can't force a
          // re-render from here without state, so just blank it — the
          // parent layout stays stable.
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }
  const fallbackTextStyle = {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(26px, 5.5vw, 34px)',
    letterSpacing: '0.12em',
    lineHeight: 1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 'min(60vw, 380px)'
  }
  if (company) {
    return (
      <span style={{ ...fallbackTextStyle, color: 'var(--field-gold-bright)' }}>
        {company}
      </span>
    )
  }
  if (fullName) {
    return (
      <span style={{ ...fallbackTextStyle, color: 'var(--ink-strong)' }}>
        {fullName}
      </span>
    )
  }
  // Final fallback — FIELDHORSE wordmark
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(26px, 5.5vw, 34px)',
        letterSpacing: '0.14em',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2
      }}
    >
      <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
      <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
    </span>
  )
}
