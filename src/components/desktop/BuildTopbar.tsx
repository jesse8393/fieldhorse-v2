// Shared desktop top bar used by Snow*Build screens. Was inlined in
// every screen component; extracted so /compose, /bid, /settings (and
// any future tool screens) get the same header without copy/paste.
// Mobile (<900px) renders nothing, phone screens get the AppHeader
// instead.
import { Search, Bell } from 'lucide-react'
import type { ReactNode } from 'react'

type BuildTopbarProps = {
  /** Optional override for the placeholder text. */
  searchPlaceholder?: string
  /** Right-side meta items, rendered as <span>'s separated by a vline. */
  meta?: ReactNode[]
  /** Optional primary CTA (gold "+ New X" button). Omit to use the
   *  --no-cta variant so the grid collapses cleanly. */
  cta?: ReactNode
}

export default function BuildTopbar({
  searchPlaceholder = 'Search jobs, clients, invoices, notes…',
  meta,
  cta,
}: BuildTopbarProps) {
  return (
    <header className={`fh-build-topbar${cta ? '' : ' fh-build-topbar--no-cta'}`}>
      <button
        type="button"
        className="fh-build-search"
        onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
        aria-label="Open command palette"
      >
        <Search size={14} />
        <span>{searchPlaceholder}</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="fh-build-topbar__meta">
        {(meta || []).map((node, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <span className="fh-build-vline" />}
            <span style={{ whiteSpace: 'nowrap' }}>{node}</span>
          </span>
        ))}
      </div>
      <button
        className="fh-build-icon-btn"
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))}
        aria-label="Open activity"
        title="Activity"
      >
        <Bell size={16} />
      </button>
      {cta}
    </header>
  )
}
