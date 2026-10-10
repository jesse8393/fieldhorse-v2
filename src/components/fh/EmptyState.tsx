import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import Icon from './Icon.tsx'
import { cx } from './cx.ts'

// Empty list (spec 7 and 9.13): an icon, one line, and the one action that
// fills the list, as a Button. The Jobs empty state, for example, offers
// "Import from Jobber" (/import).

export type EmptyStateProps = {
  icon: LucideIcon
  /** The one line, such as "No jobs yet." */
  title: ReactNode
  /** The one action that fills the list: a Button. */
  action?: ReactNode
  className?: string
}

export default function EmptyState({ icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={cx('fhc-empty', className)}>
      <span className="fhc-empty__icon" aria-hidden="true">
        <Icon icon={icon} size={24} />
      </span>
      <p className="fhc-empty__title">{title}</p>
      {action != null && <div className="fhc-empty__action">{action}</div>}
    </div>
  )
}
