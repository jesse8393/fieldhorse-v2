// src/screens/ContactDetail/sections/ActivityLog.tsx
//
// Per-job activity timeline. Composes events from existing data
// (notes, payments, schedule, change orders, contact metadata), no
// new schema. Pure presentation; the parent passes already-loaded
// arrays.
//
// Shows a "vertical rail" timeline with:
//   - colored dot per event (tone-coded)
//   - title + sub
//   - relative date (e.g. "2d ago" / "yesterday" / "Mar 14")
//
// Caps the visible list at 10 entries by default with a "Show all"
// expander, so a job with months of history doesn't flood the
// Overview tab.

import { useMemo, useState } from 'react'
import { Activity, FileText, DollarSign, Calendar, FileEdit, Check, Sparkles } from 'lucide-react'
import { composeActivityEvents } from './composeActivityEvents.ts'
import { Eyebrow } from '../../../components/v3'

const ICONS: Record<string, any> = {
  created: Sparkles,
  stage: Activity,
  note: FileText,
  payment: DollarSign,
  schedule: Calendar,
  change_order: FileEdit,
  change_order_approved: Check
}

const TONE_COLORS: Record<string, any> = {
  neutral: { fg: 'var(--v3-text-muted)', bg: 'var(--v3-glass-tint-2)', dot: 'var(--v3-text-muted)' },
  gold:    { fg: 'var(--v3-primary-bright)', bg: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)', dot: 'var(--v3-primary)' },
  green:   { fg: 'var(--v3-success-bright, #2D7A4F)', bg: 'rgba(45, 122, 79, 0.10)', dot: 'var(--v3-success-bright, #2D7A4F)' },
  red:     { fg: 'var(--v3-danger-bright, #C9963A)', bg: 'rgba(192, 57, 43, 0.10)', dot: 'var(--v3-danger-bright, #C9963A)' }
}

function relTime(d: any) {
  if (!d) return ''
  const now = new Date()
  const diffMs = now.getTime() - new Date(d).getTime()
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (diffDays < 0) {
    // Future event (scheduled)
    if (Math.abs(diffDays) === 1) return 'tomorrow'
    if (Math.abs(diffDays) < 7) return `in ${Math.abs(diffDays)}d`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000))
    if (diffHours < 1) return 'just now'
    return `${diffHours}h ago`
  }
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const DEFAULT_LIMIT = 10

export default function ActivityLog({
  contact,
  notes = [],
  payments = [],
  scheduleItems = [],
  changeOrders = [],
  stageTransitions = []
}: any) {
  const events = useMemo(
    () => composeActivityEvents({ contact, notes, payments, scheduleItems, changeOrders, stageTransitions }),
    [contact, notes, payments, scheduleItems, changeOrders, stageTransitions]
  )
  const [expanded, setExpanded] = useState(false)

  if (events.length === 0) return null

  const visible = expanded ? events : events.slice(0, DEFAULT_LIMIT)
  const hiddenCount = events.length - visible.length

  return (
    <section
      style={{
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        borderRadius: 10,
        overflow: 'hidden'
      }}
    >
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        borderBottom: '1px solid var(--v3-border)',
        background: 'var(--v3-surface-2)'
      }}>
        <Activity size={14} aria-hidden="true" style={{ color: 'var(--v3-primary-bright)' }} />
        <Eyebrow tone="gold">
          Activity
          <span style={{ marginLeft: 8, color: 'var(--v3-text-muted)' }}>
            · {events.length}
          </span>
        </Eyebrow>
      </header>

      <ol style={{
        listStyle: 'none', padding: '16px 16px 8px', margin: 0,
        position: 'relative'
      }}>
        {/* Vertical rail behind every dot */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 23, top: 22, bottom: 16, width: 1,
            background: 'var(--v3-border)'
          }}
        />
        {visible.map((e) => {
          const Icon = ICONS[e.kind] || Activity
          const tone = TONE_COLORS[e.tone || 'neutral']
          return (
            <li
              key={e.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr auto',
                gap: 12,
                paddingBottom: 12,
                alignItems: 'flex-start',
                position: 'relative'
              }}
            >
              {/* Dot + icon */}
              <span
                aria-hidden="true"
                style={{
                  width: 16, height: 16, borderRadius: 10,
                  background: tone.bg,
                  border: `1.5px solid ${tone.dot}`,
                  display: 'inline-grid', placeItems: 'center',
                  marginLeft: 8, marginTop: 2,
                  position: 'relative', zIndex: 1
                }}
              >
                <Icon size={9} color={tone.fg} aria-hidden="true" />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                  color: 'var(--v3-text)', lineHeight: 1.35
                }}>
                  {e.title}
                </div>
                {e.sub && (
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-body)', fontSize: 12,
                    color: 'var(--v3-text-muted)', lineHeight: 1.4,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {e.sub}
                  </div>
                )}
              </div>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                color: 'var(--v3-text-faint, var(--v3-text-muted))',
                letterSpacing: 0,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
                paddingTop: 4
              }}>
                {relTime(e.when)}
              </span>
            </li>
          )
        })}
      </ol>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            display: 'block', width: '100%',
            padding: '12px 16px',
            borderTop: '1px solid var(--v3-border)',
            background: 'transparent', border: 'none',
            color: 'var(--v3-primary-bright)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: 0, cursor: 'pointer',
            textAlign: 'center'
          }}
        >
          Show {hiddenCount} more
        </button>
      )}
    </section>
  )
}
