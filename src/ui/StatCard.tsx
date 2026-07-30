import type { ReactNode } from 'react'
import Card from './Card.tsx'

type StatCardProps = {
  label: ReactNode
  value: ReactNode
  subline?: ReactNode
  change?: number | null
}

export default function StatCard({ label, value, subline, change }: StatCardProps) {
  const showChange = typeof change === 'number' && change !== 0

  return (
    <Card className="fh-stat-card" padding="md">
      <span className="fh-stat-card__label">{label}</span>
      <strong className="fh-stat-card__value">{value}</strong>
      {subline ? <span className="fh-stat-card__subline">{subline}</span> : null}
      {showChange ? (
        <span className={`fh-stat-card__change fh-stat-card__change--${change > 0 ? 'up' : 'down'}`}>
          <span aria-hidden="true">{change > 0 ? '↑' : '↓'}</span>
          {Math.abs(change)}%
        </span>
      ) : null}
    </Card>
  )
}
