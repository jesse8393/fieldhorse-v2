// SnowSettingsBuild — desktop chrome wrapper for /settings.
//
// Presentational only. Receives the existing form section JSX as
// children and renders it inside the Build topbar + hero + signal
// rail. All form handlers and save behavior continue to run inside
// the children unchanged.

import type { ReactNode } from 'react'
import { Bell, Search, LogOut, CheckCircle2 } from 'lucide-react'
import MiniMetric from '../MiniMetric.tsx'
import TopbarWeather from './TopbarWeather.tsx'

type Props = {
  userEmail?: string | null
  companyName?: string | null
  profileCompletePct: number      // 0-100
  brandReady: boolean
  servicesCount: number
  hasLogo: boolean
  hasLocation: boolean
  missingItems: string[]          // honest list of unfilled fields
  onSignOut?: () => void
  children: ReactNode
}

export default function SnowSettingsBuild(props: Props) {
  const {
    userEmail, companyName, profileCompletePct, brandReady, servicesCount,
    hasLogo, hasLocation, missingItems, onSignOut, children,
  } = props

  const allClear = missingItems.length === 0

  return (
    <div className="fh-build-page" data-build-screen="SnowSettingsBuild">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search settings, integrations, billing...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{companyName || userEmail || 'Account'}</span>
          <span className="fh-build-vline" />
          <TopbarWeather />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Settings</div>
            <h1 className="fh-build-title">CONTROL ROOM.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Setup readiness</div>
            <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px' }}>
              {profileCompletePct >= 90 ? 'Looking sharp' : profileCompletePct >= 60 ? 'Almost there' : 'Needs setup'}
            </p>
            <div className="fh-build-progress">
              <div className="fh-build-progress__track">
                <div
                  className="fh-build-progress__fill"
                  style={{ width: `${Math.max(profileCompletePct, 4)}%` }}
                />
              </div>
              <span>{profileCompletePct}% complete</span>
            </div>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Profile" value={`${profileCompletePct}%`} accent />
            <MiniMetric label="Brand" value={brandReady ? 'Ready' : 'Incomplete'} tone={brandReady ? undefined : 'warn'} />
            <MiniMetric label="Services" value={String(servicesCount)} />
            <MiniMetric label="Location" value={hasLocation ? 'Pinned' : 'Not pinned'} tone={hasLocation ? undefined : 'warn'} />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--settings">
          <div className="fh-build-settings-main">
            {children}
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Brand status</div>
              <strong>{brandReady ? 'Ready' : 'Incomplete'}</strong>
              <span>
                {hasLogo ? 'Logo uploaded' : 'No logo uploaded'}
                {brandReady && hasLogo ? '' : null}
              </span>
              {!brandReady && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Missing setup</div>
              {allClear ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                    <CheckCircle2 size={16} color="var(--v3-success-bright)" />
                    <strong style={{ fontSize: 20, color: 'var(--v3-success-bright)' }}>All set</strong>
                  </div>
                  <span>Profile and brand fully configured.</span>
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--v3-primary-bright)' }}>{missingItems.length}</strong>
                  <span>field{missingItems.length === 1 ? '' : 's'} to fill</span>
                  <ul className="fh-build-rail-list" style={{ marginTop: 12 }}>
                    {missingItems.slice(0, 4).map((m, i) => (
                      <li key={i} style={{ gridTemplateColumns: '1fr' }}>
                        <span className="fh-build-rail-list__title" title={m}>{m}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Connected systems</div>
              <strong>—</strong>
              <span>Integrations not tracked yet</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Document readiness</div>
              <strong>{brandReady && hasLogo ? 'Ready' : 'Partial'}</strong>
              <span>{brandReady && hasLogo ? 'Estimates + invoices branded' : 'Add logo for branded docs'}</span>
            </section>

            <section className="fh-build-rail-card fh-build-rail-card--account">
              <div className="fh-build-eyebrow">Account</div>
              <div
                className="fh-build-account-email"
                title={userEmail || ''}
              >
                {userEmail || '—'}
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
      </main>
    </div>
  )
}

