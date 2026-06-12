// src/components/CaptureFab.tsx
//
// The always-there gold capture button. Floats above the bottom nav on
// mobile and bottom-right on desktop; one tap opens the CaptureSheet
// (which also answers Cmd/Ctrl+J and the command palette entry).
// Rendered by AppShell so it exists on every authed screen.

import { Mic } from 'lucide-react'
import { hapticTap } from '../lib/haptics.ts'

export default function CaptureFab() {
  return (
    <button
      type="button"
      aria-label="Capture — voice, text, or receipt"
      title="Capture (⌘J)"
      onClick={() => {
        hapticTap()
        window.dispatchEvent(new CustomEvent('fh:open-capture'))
      }}
      style={{
        position: 'fixed',
        right: 16,
        // Sits above the 64px bottom nav + safe area on phones; the same
        // offset reads fine bottom-right on desktop where there's no nav.
        bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
        zIndex: 40,
        width: 56,
        height: 56,
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
        background: 'var(--v3-primary)',
        color: '#141110',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.3)',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <Mic size={22} />
    </button>
  )
}
