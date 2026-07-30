import { motion } from 'framer-motion'
import { Hammer, FileText, Receipt, Camera, Activity, Trash2 } from 'lucide-react'
import Pill from './Pill.tsx'
import { hapticTap } from '../../lib/haptics.ts'

const ICONS: Record<string, import('react').ComponentType<any>> = {
  'crew-on-site': Hammer,
  'photos': Camera,
  'invoice': Receipt,
  'note': FileText,
  default: Activity
}
const TONE: Record<string, { color: string; bg: string }> = {
  'crew-on-site': { color: 'var(--v3-stage-active)', bg: 'rgba(45, 122, 79, 0.14)' },
  'photos':       { color: 'var(--v3-primary)',      bg: 'var(--v3-primary-soft)' },
  'invoice':      { color: 'var(--v3-primary)',      bg: 'var(--v3-primary-soft)' },
  'note':         { color: 'var(--v3-text-muted)',   bg: 'var(--v3-glass-tint)' },
  default:        { color: 'var(--v3-text-muted)',   bg: 'var(--v3-glass-tint)' }
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • ${time}`
}

type FeedRowProps = {
  type?: string
  title?: import('react').ReactNode
  detail?: import('react').ReactNode
  timestamp?: string | null
  pillTone?: any
  pillLabel?: import('react').ReactNode
  onTap?: () => void
  onDelete?: () => void
  deleteLabel?: string
}

export default function FeedRow({
  type = 'default',
  title,
  detail,
  timestamp,
  pillTone,
  pillLabel,
  onTap,
  onDelete,
  deleteLabel = 'Delete'
}: FeedRowProps) {
  const Icon = ICONS[type] || ICONS.default
  const tone = TONE[type] || TONE.default
  // Tap only fires when there's an onTap AND no nested delete control was
  // clicked. Delete owns its own click + haptic; we stop propagation in
  // the delete handler so the row's onTap doesn't also fire.
  const interactive = !!onTap

  const Tag: any = interactive ? motion.button : motion.div
  const tagProps: any = interactive
    ? { type: 'button', whileTap: { scale: 0.99 }, onClick: () => { hapticTap(); onTap!() } }
    : {}

  return (
    <Tag
      {...tagProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 12px',
        borderRadius: 'var(--v3-radius-card)',
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        textAlign: 'left',
        width: '100%',
        cursor: interactive ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
        color: 'inherit'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          background: tone.bg,
          color: tone.color
        }}
      >
        <Icon size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--v3-text)',
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--v3-text-muted)',
            marginTop: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {detail}
          {timestamp ? <span style={{ opacity: 0.7 }}>{detail ? ' • ' : ''}{formatTime(timestamp)}</span> : null}
        </div>
      </div>
      {pillLabel ? <Pill tone={pillTone || 'success'}>{pillLabel}</Pill> : null}
      {onDelete && (
        <button
          type="button"
          aria-label={deleteLabel}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            hapticTap()
            onDelete?.()
          }}
          style={{
            flexShrink: 0,
            width: 32, height: 32, borderRadius: 10,
            background: 'transparent',
            border: '1px solid var(--v3-border)',
            color: 'var(--v3-text-muted)',
            display: 'grid', placeItems: 'center',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </Tag>
  )
}
