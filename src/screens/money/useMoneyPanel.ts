// The Money sub pages (Who owes you, All invoices, Job balances) live in
// the URL as ?panel=, so Back closes them. The phone and the desktop
// screen share this: which panel is open, the link that opens one, and
// the Back that closes it.
//
// A page opens at its top; closing it returns to where Money was scrolled
// and puts focus back on the Money heading.

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isMoneyPanel, type MoneyPanel } from './MoneyPanels.tsx'

export function useMoneyPanel() {
  const [searchParams, setSearchParams] = useSearchParams()

  const panelParam = searchParams.get('panel')
  const panel: MoneyPanel | null = isMoneyPanel(panelParam) ? panelParam : null

  const titleRef = useRef<HTMLHeadingElement>(null)
  const scrollBefore = useRef(0)
  const wasPanel = useRef(false)
  useEffect(() => {
    if (panel) {
      wasPanel.current = true
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else if (wasPanel.current) {
      wasPanel.current = false
      window.scrollTo({ top: scrollBefore.current, behavior: 'instant' })
      titleRef.current?.focus({ preventScroll: true })
    }
  }, [panel])

  const panelHref = (id: MoneyPanel) => {
    const sp = new URLSearchParams(searchParams)
    sp.set('panel', id)
    return `?${sp.toString()}`
  }

  /** Call as a link opens a panel, so Back returns to this scroll position. */
  const openPanel = () => {
    scrollBefore.current = window.scrollY
  }

  // This control promises Money, even after changing reconciliation buckets.
  // Browser Back retains its usual history behavior separately.
  const closePanel = () => {
    const sp = new URLSearchParams(searchParams)
    sp.delete('panel')
    sp.delete('bucket')
    setSearchParams(sp, { replace: true })
  }

  return { panel, titleRef, panelHref, openPanel, closePanel }
}
