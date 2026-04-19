import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { supabase } from '../lib/supabase.js'
import FieldhorseBadge from './FieldhorseBadge.jsx'

/**
 * AppHeader — the shared top bar.
 *
 * Layout:
 *   [FH badge 26px] · · · [USER COMPANY LOGO / NAME centered] · · · [bell + count]
 *
 * Fallback chain for center slot:
 *   1. profile.logo_url     -> <img>
 *   2. profile.company_name -> Bebas Neue, Field Gold tint
 *   3. profile.full_name    -> Bebas Neue, white
 *   4. (everything blank)   -> FIELDHORSE wordmark
 *
 * Partner view: always renders THIS user's brand (not the inviter's).
 * Shared-job content is shared; chrome is not.
 */
export default function AppHeader() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [notesCount, setNotesCount] = useState(0)

  useEffect(() => {
    if (!user) { setNotesCount(0); return }
    let cancelled = false
    supabase
      .from('fh_notes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('done', false)
      .then(({ count }) => {
        if (!cancelled) setNotesCount(count || 0)
      })
    return () => { cancelled = true }
  }, [user])

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
        padding: '16px 20px 12px',
        paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
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
        aria-label={notesCount > 0 ? `Notifications — ${notesCount} open note${notesCount === 1 ? '' : 's'}` : 'Notifications'}
        onClick={() => navigate('/notes')}
        style={{
          width: 36,
          height: 36,
          minWidth: 36,
          borderRadius: 11,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--rule)',
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          color: 'var(--ink-strong)',
          cursor: 'pointer',
          padding: 0
        }}
      >
        <Bell size={16} />
        {notesCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 7,
              right: 7,
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--alert-red)',
              boxShadow: '0 0 0 2px var(--surface-0)'
            }}
          />
        )}
      </button>
    </header>
  )
}

function BrandSlot({ logoSrc, company, fullName }) {
  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        alt={company || 'Company logo'}
        style={{
          maxHeight: 36,
          maxWidth: 'min(60vw, 260px)',
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
  if (company) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--field-gold-bright)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 'min(60vw, 260px)'
        }}
      >
        {company}
      </span>
    )
  }
  if (fullName) {
    return (
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-strong)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: 'min(60vw, 260px)'
        }}
      >
        {fullName}
      </span>
    )
  }
  // Final fallback — FIELDHORSE wordmark
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
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
