// src/components/CaptureFab.tsx
//
// The always-there capture button. Joins the canonical .fh-fab system
// (visuals + position owned by global.css) as the circular mic variant;
// when the current screen ships its own "+" FAB (Leads / Jobs / Clients
// / Schedule), CSS stacks capture above it instead of overlapping —
// see the .fh-fab--capture rules in global.css. One tap opens the
// CaptureSheet (which also answers Cmd/Ctrl+J and the command palette).
//
// Portaled to document.body for the same reason FloatingActionButton
// is: ancestor transforms from framer-motion screens would otherwise
// re-anchor position:fixed.

import { createPortal } from 'react-dom'
import { Mic } from 'lucide-react'
import { hapticMedium } from '../lib/haptics.ts'

export default function CaptureFab() {
  if (typeof document === 'undefined') return null

  const button = (
    <button
      type="button"
      aria-label="Capture — voice, text, or receipt"
      title="Capture (⌘J)"
      className="fh-fab fh-fab--capture"
      onClick={() => {
        hapticMedium()
        window.dispatchEvent(new CustomEvent('fh:open-capture'))
      }}
    >
      <Mic size={22} />
    </button>
  )

  return createPortal(button, document.body)
}
