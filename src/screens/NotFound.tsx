// NotFound, real 404 view for unmatched routes.
//
// The old catch-all silently redirected to Home and rewrote the URL,
// so a mistyped or stale link gave no signal that anything went wrong
// (UI audit #7).

import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'

export default function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="fh-build-page" data-build-screen="NotFound">
      <main className="fh-build-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60dvh' }}>
        <section style={{ textAlign: 'center', maxWidth: 420, padding: '32px 24px' }}>
          <Compass size={28} aria-hidden="true" style={{ color: 'var(--v3-text-muted)', marginBottom: 12 }} />
          <div className="fh-build-eyebrow">Page not found</div>
          <h1 className="fh-build-title" style={{ margin: '8px 0 10px' }}>NOTHING HERE.</h1>
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, color: 'var(--v3-text-muted)' }}>
            <code style={{ fontFamily: 'inherit', color: 'var(--v3-text)' }}>{pathname}</code> doesn&rsquo;t match
            anything in FieldHorse. The link may be stale or mistyped.
          </p>
          <Link to="/" className="v3-btn v3-btn--primary v3-btn--sm" style={{ textDecoration: 'none', display: 'inline-flex' }}>
            Back to Home
          </Link>
        </section>
      </main>
    </div>
  )
}
