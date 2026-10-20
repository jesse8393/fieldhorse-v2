// The header every quote screen shares (Phase 9, D57): Back, a small word
// saying which screen this is, and whatever sits at the right (the status
// chip on the quote itself). The title under it belongs to each screen.

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { IconButton } from '../../components/fh'

/** Back goes to the previous screen, or to `home` when this is the first one. */
export function useGoBack(home: string) {
  const navigate = useNavigate()
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(home, { replace: true })
  }
}

export default function QuoteHeader({ kicker, home, end }: { kicker: string; home: string; end?: ReactNode }) {
  const goBack = useGoBack(home)
  return (
    <header className="fhqt-head">
      <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
      <span className="fhqt-kicker">{kicker}</span>
      {end}
    </header>
  )
}
