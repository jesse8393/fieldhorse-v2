import { useNavigate } from 'react-router-dom'
import { NotebookPen, Search } from 'lucide-react'
import { useProfile } from '../contexts/ProfileContext.tsx'
import FieldhorseEmblem from './FieldhorseEmblem.tsx'
import NotificationsBell from './NotificationsBell.tsx'

function openPalette() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('fh:open-palette'))
}

// Single entry point — dispatches `fh:open-palette`. CommandPalette
// only opens at >=900px width; MobileSearchOverlay only opens at
// <900px. Both gate themselves so we never get a dual-open. The old
// mobile-routes-to-/jobs hack was a workaround for the cmdk popover
// rendering clipped on iOS — superseded by the dedicated mobile
// overlay.
function openSearch() {
  openPalette()
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
        // Padding longhand ONLY — never use the `padding:` shorthand
        // here. The desktop sidebar offset is applied via the CSS rule
        // `@media(min-width:900px) .fh-app-header { padding-left: calc(14px + 256px) }`,
        // which loses to inline shorthand. The audit on 5/13 found
        // the search/notifications/notes cluster pinned behind the
        // 256px sidebar because the inline `padding: '6px 14px 4px'`
        // was forcing padding-left:14 over the responsive rule. Keep
        // top/right/bottom inline; let CSS own padding-left.
        paddingTop: 'calc(6px + env(safe-area-inset-top, 0px))',
        paddingRight: 14,
        paddingBottom: 4,
        paddingLeft: 14, // mobile default — overridden by desktop CSS rule
        minHeight: 0,
        background: 'linear-gradient(180deg, rgba(20,20,20,0.88) 0%, rgba(20,20,20,0.72) 82%, rgba(20,20,20,0) 100%)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        pointerEvents: 'auto'
      }}
    >
      {/* Brand emblem — phone-only. Desktop mounts the wordmark in the
          left rail (DesktopSidebar) so the header strip can stay quiet.
          Replaces the prior FieldhorseBadge (FH text wordmark) with the
          glassy gold emblem the user shared. */}
      <span className="fh-app-header__badge">
        <FieldhorseEmblem size={28} />
      </span>

      <div
        className="fh-app-header__brand"
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
          onClick={() => openSearch()}
          className="fh-header-search-btn"
          style={{
            width: 34,
            height: 34,
            minWidth: 34,
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
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
            width: 34,
            height: 34,
            minWidth: 34,
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
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

function BrandSlot({ logoSrc, company, fullName }: any) {
  // Mobile-header-fix: the thin-ribbon trim left the wordmark visibly
  // weak on iPhone — at clamp(12px, 2.6vw, 14px) on a 390px viewport the
  // brand max'd at 14px and read as a faint placeholder. Bumped to
  // clamp(15px, 4vw, 18px) so the contractor's name registers as
  // immediate identification without taking over the header strip.
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={company || 'Company logo'}
        style={{
          maxHeight: 'clamp(22px, 4.6vw, 30px)',
          maxWidth: 'min(38vw, 200px)',
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
    fontSize: 'clamp(15px, 4vw, 18px)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    lineHeight: 1,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 'min(56vw, 240px)'
  }
  if (company) {
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
  // Final fallback — FIELDHORSE wordmark with the gold-split FIELD/HORSE.
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(15px, 4.2vw, 19px)',
        fontWeight: 600,
        letterSpacing: '0.08em',
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
