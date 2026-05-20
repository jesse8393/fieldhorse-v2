import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

type SectionHeaderProps = {
  label: ReactNode
  action?: {
    onTap?: () => void
    label: ReactNode
    showChevron?: boolean
  }
}

export default function SectionHeader({ label, action }: SectionHeaderProps) {
  return (
    <div className="v3-section-header">
      <span className="v3-eyebrow">{label}</span>
      {action ? (
        <button type="button" className="v3-section-link" onClick={action.onTap}>
          {action.label}
          {action.showChevron !== false ? <ChevronRight size={12} aria-hidden="true" /> : null}
        </button>
      ) : null}
    </div>
  )
}
