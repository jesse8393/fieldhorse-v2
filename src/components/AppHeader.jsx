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
        // V3-SYSTEM-1A: tightened from 14/14/12 → 10/14/9 so the header
        // total is ~52px+safe-area instead of ~70px. Header is supporting
        // chrome, not a hero panel.
        padding: '10px 14px 9px',
        paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
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
      {/* V3-SYSTEM-1A: trio of header actions demoted from 44×44 / r11 →
          36×36 / r9 with a 14px icon. Tap target stays comfortable
          (36 > Apple 28pt minimum + the touch area extends to header
          padding) and the cluster widths drops from ~140px → ~116px so
          the centered logo gets back its share of the header. */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          aria-label="Search everything"
          onClick={openPalette}
          className="fh-header-search-btn"
          style={{
            width: 36,
            height: 36,
            minWidth: 36,
            borderRadius: 9,
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
          <Search size={14} />
        </button>
        <NotificationsBell />
        <button
          type="button"
          aria-label="Notes"
          onClick={() => navigate('/notes')}
          className="fh-header-notes-btn"
          style={{
            width: 36,
            height: 36,
            minWidth: 36,
            borderRadius: 9,
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
          <NotebookPen size={14} />
        </button>
      </div>
    </header>
  )
}

function BrandSlot({ logoSrc, company, fullName }) {
  // V3-SYSTEM-1A: header is supporting chrome, not a hero. Logo scales
  // up to 32px tall on desktop (was 56) — small enough that the actual
  // app content leads, large enough to recognize the brand at a glance.
  // Text fallbacks land at 18px max (was 28) for the same reason.
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={company || 'Company logo'}
        style={{
          maxHeight: 'clamp(22px, 4vw, 32px)',
          maxWidth: 'min(40vw, 220px)',
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
    fontSize: 'clamp(14px, 3.2vw, 18px)',
    letterSpacing: '0.08em',
    lineHeight: 1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 'min(44vw, 220px)'
  }
  if (company) {
    // V3-SYSTEM-1A: company-name fallback drops the gold tint — the
    // header is brand-supporting, not a brand moment. Gold is reserved
    // for actions / revenue / active route; chrome stays muted ink.
    return (
      <span style={{ ...fallbackTextStyle, color: 'var(--ink-strong)' }}>
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
  // Final fallback — FIELDHORSE wordmark. Keeps the gold-split FIELD/HORSE
  // when there's no user brand to compete with, so anonymous users still
  // see the brand identity in the header.
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(14px, 3.2vw, 18px)',
        letterSpacing: '0.10em',
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
