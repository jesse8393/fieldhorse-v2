// InstallPrompt, surfaces an "Install" CTA so users don't have to
// hunt for the address-bar icon or the three-dot menu.
//
// Three modes:
//   1. Chrome / Edge / Android Chrome:
//      - Captures the `beforeinstallprompt` event (prevents the
//        browser's silent auto-prompt)
//      - Shows a banner with an explicit "Install" button that fires
//        the deferred prompt on click
//   2. iOS Safari (fires no beforeinstallprompt at all):
//      - Shows a hint banner pointing at Share → Add to Home Screen
//   3. Already installed (display-mode: standalone OR navigator.standalone):
//      - Renders nothing
//
// Dismissal is sticky for 30 days via localStorage so we don't nag.
// Auto-clears on `appinstalled` so the banner disappears the moment
// the install completes.

import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'

const DISMISS_KEY = 'fh-pwa-install-dismissed-at'
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return (navigator as unknown as { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent
  if (!/iPad|iPhone|iPod/.test(ua)) return false
  // Exclude in-app browsers (FB, Instagram) where Add to Home Screen
  // isn't available, showing the hint there would be wrong.
  if (/FBAN|FBAV|Instagram|Line\//i.test(ua)) return false
  return true
}

function wasRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const dismissedAt = Number(raw)
    if (!Number.isFinite(dismissedAt)) return false
    return Date.now() - dismissedAt < DISMISS_TTL_MS
  } catch {
    return false
  }
}

function rememberDismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // private mode etc, banner just re-shows next session, that's ok
  }
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPrompt | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (wasRecentlyDismissed()) return

    if (isIos()) {
      // Defer 3s so the banner doesn't slam in on first paint while
      // the rest of the app is still hydrating.
      const t = window.setTimeout(() => setIosHint(true), 3000)
      return () => window.clearTimeout(t)
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as DeferredInstallPrompt)
    }
    function onInstalled() {
      setDeferredPrompt(null)
      setIosHint(false)
      setHidden(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (hidden) return null
  if (!deferredPrompt && !iosHint) return null

  const handleInstall = async () => {
    if (!deferredPrompt) return
    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'dismissed') rememberDismiss()
    } catch {
      // user cancelled the chooser, treat like a dismiss so we don't loop
      rememberDismiss()
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    rememberDismiss()
    setHidden(true)
  }

  const isIosMode = iosHint && !deferredPrompt

  return (
    <div
      role="dialog"
      aria-label="Install Fieldhorse"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        // Sit above the mobile BottomNav (it ranges ~64–80px tall) and
        // safe-area inset on notched devices.
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 12px',
        background: 'rgba(20, 20, 20, 0.96)',
        backdropFilter: 'saturate(140%) blur(12px)',
        WebkitBackdropFilter: 'saturate(140%) blur(12px)',
        border: '1px solid rgba(201, 150, 58, 0.35)',
        borderRadius: 10,
        boxShadow: '0 20px 50px rgba(20, 20, 20, 0.45)',
        color: 'var(--ink-strong, #F2EDE4)',
        maxWidth: 520,
        margin: '0 auto',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(201, 150, 58,0.25), rgba(201, 150, 58,0.08))',
          border: '1px solid rgba(201, 150, 58, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isIosMode ? <Share size={18} color="#C9963A" /> : <Download size={18} color="#C9963A" />}
      </div>

      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Install Fieldhorse</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
          {isIosMode
            ? 'Tap Share, then "Add to Home Screen"'
            : 'Add to your home screen for one tap access.'}
        </div>
      </div>

      {!isIosMode && (
        <button
          type="button"
          onClick={handleInstall}
          style={{
            padding: '8px 12px',
            background: '#C9963A',
            color: '#141414',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Install
        </button>
      )}

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
        style={{
          padding: 8,
          background: 'transparent',
          color: 'var(--ink-strong, #F2EDE4)',
          opacity: 0.5,
          border: 'none',
          borderRadius: 10,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
