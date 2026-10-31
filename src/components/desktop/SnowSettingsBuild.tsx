// SnowSettingsBuild, desktop chrome wrapper for /settings.
//
// Presentational only. Receives the existing form section JSX as
// children and renders it inside the Build topbar + hero + signal
// rail. All form handlers and save behavior continue to run inside
// the children unchanged.

import type { ReactNode } from 'react'
import { Bell, Search, LogOut, CheckCircle2, MapPin } from 'lucide-react'
import { Button } from '../fh'
import MiniMetric from '../MiniMetric.tsx'
import TopbarWeather from './TopbarWeather.tsx'
import PaletteKeyCap, { paletteShortcut } from './PaletteKeyCap.tsx'

type Props = {
  userEmail?: string | null
  companyName?: string | null
  companyReady: boolean
  brandReady: boolean
  servicesCount: number
  hasLogo: boolean
  hasLocation: boolean
  optionalItems: string[]
  onSignOut?: () => void
  children: ReactNode
}

export default function SnowSettingsBuild(props: Props) {
  const {
    userEmail, companyName, companyReady, brandReady, servicesCount,
    hasLogo, hasLocation, optionalItems, onSignOut, children,
  } = props

  const allClear = optionalItems.length === 0

  return (
    <div className="fh-build-page fh-settings" data-build-screen="SnowSettingsBuild">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search Fieldhorse...</span>
          <PaletteKeyCap />
        </button>
        <div className="fh-build-topbar__meta">
          <span>{companyName || userEmail || 'Account'}</span>
          <TopbarWeather lead />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <div className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Account</div>
            <h1 className="fh-build-title">Settings</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Business profile</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px' }}>
              {companyReady ? 'Company profile ready' : 'Add your company name'}
            </p>
            <p className="fh-settings-help">Only your company name is needed to get started. All other details are optional.</p>
            {!hasLocation && <Button to="/settings#location" variant="quiet" size="mini" icon={MapPin}>Set location</Button>}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Company" value={companyReady ? 'Added' : 'Needed'} accent />
            <MiniMetric label="Brand" value={brandReady ? 'Custom' : 'Default'} />
            <MiniMetric label="Services" value={String(servicesCount)} />
            <MiniMetric label="Location" value={hasLocation ? 'Pinned' : 'Optional'} />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--settings">
          <div className="fh-build-settings-main">
            {children}
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Brand status</div>
              <strong>{brandReady ? 'Custom branding' : 'Default branding'}</strong>
              <span>
                {hasLogo ? 'Logo uploaded' : 'Add a logo whenever you are ready'}
              </span>
              {!brandReady && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Optional additions</div>
              {allClear ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <CheckCircle2 size={16} color="var(--v3-success-bright)" />
                    <strong style={{ fontSize: 20, color: 'var(--v3-success-text)' }}>All set</strong>
                  </div>
                  <span>All optional profile details are filled in.</span>
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--v3-primary-text)' }}>{optionalItems.length}</strong>
                  <span>optional detail{optionalItems.length === 1 ? '' : 's'} you can add</span>
                  <ul className="fh-build-rail-list" style={{ marginTop: 12 }}>
                    {optionalItems.map((m, i) => (
                      <li key={i} style={{ gridTemplateColumns: '1fr' }}>
                        <span className="fh-build-rail-list__title" title={m}>{m}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Document identity</div>
              <strong>{companyReady ? 'Company name added' : 'Company name needed'}</strong>
              <span>{hasLogo ? 'Logo added to your documents' : 'A logo is optional for your documents'}</span>
            </section>

            <section className="fh-build-rail-card fh-build-rail-card--account">
              <div className="fh-build-eyebrow">Account</div>
              <div
                className="fh-build-account-email"
                title={userEmail || ''}
              >
                {userEmail || '\u2003'}
              </div>
              <span>Signed in</span>
              {onSignOut && (
                <button type="button" className="fh-build-rail-card__action" onClick={onSignOut}>
                  <LogOut size={13} /> Sign out
                </button>
              )}
            </section>
          </aside>
        </section>
      </div>
    </div>
  )
}

