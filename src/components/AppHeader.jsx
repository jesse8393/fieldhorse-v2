import { useNavigate } from 'react-router-dom'
import { NotebookPen, Search } from 'lucide-react'
import { useProfile } from '../contexts/ProfileContext.jsx'
import FieldhorseBadge from './FieldhorseBadge.jsx'
import NotificationsBell from './NotificationsBell.jsx'

function openPalette() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('fh:open-palette'))
}

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
        gap: 8,
        padding: '14px 14px 12px',
        paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))',
        minHeight: 0,
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
          gap: 6,
          overflow: 'hidden'
        }}
      >
        <BrandSlot logoSrc={logoSrc} company={company} fullName={fullName} />
      </div>

      {/* Right slot: search + notifications + notes shortcut.
          Search opens the universal palette (jobs/clients/notes/events/
          files in one query, also bound to ⌘K). The bell shows unread
          count badge + opens the inbox drawer. Notes is a quick jump
          to /notes. */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          aria-label="Search everything"
          onClick={openPalette}
          className="fh-header-search-btn"
          style={{
            width: 44,
            height: 44,
            minWidth: 44,
            borderRadius: 11,
            background: 'var(--surface-2)',
            border: '1px solid var(--rule)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--ink-strong)',
            cursor: 'pointer',
            padding: 0,
            transition: 'color 160ms ease, background 160ms ease, border-color 160ms ease'
          }}
        >
          <Search size={16} />
        </button>
        <NotificationsBell />
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
            background: 'var(--surface-2)',
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
      </div>
    </header>
  )
}

function BrandSlot({ logoSrc, company, fullName }) {
  // Brand sits between FH badge (left) and the Search/Bell/Notes cluster
  // (right). Bumped about 3 sizes from the previous "way small" pass —
  // logo image now scales up to 56 px tall on desktop (was 28), text
  // fallback to 28 px (was 15). On phone it still clamps at 30 px /
  // 16 px so it doesn't crowd the right-side buttons.
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={company || 'Company logo'}
        style={{
          maxHeight: 'clamp(30px, 7vw, 56px)',
          maxWidth: 'min(50vw, 320px)',
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
    fontSize: 'clamp(16px, 4.6vw, 28px)',
    letterSpacing: '0.1em',
    lineHeight: 1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 'min(52vw, 320px)'
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
        fontSize: 'clamp(16px, 4.6vw, 28px)',
        letterSpacing: '0.12em',
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
