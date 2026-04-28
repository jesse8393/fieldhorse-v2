import { motion } from 'framer-motion'
import { Hammer, FileText, Receipt, Camera, Activity } from 'lucide-react'
import Pill from './Pill.jsx'
import { hapticTap } from '../../lib/haptics.js'

const ICONS = {
  'crew-on-site': Hammer,
  'photos': Camera,
  'invoice': Receipt,
  'note': FileText,
  default: Activity
}
const TONE = {
  'crew-on-site': { color: '#4ADE80', bg: 'rgba(46,204,113,0.12)' },
  'photos': { color: '#D4AF37', bg: 'rgba(212,175,55,0.10)' },
  'invoice': { color: '#D4AF37', bg: 'rgba(212,175,55,0.10)' },
  'note': { color: '#A1A1AA', bg: 'rgba(255,255,255,0.05)' },
  default: { color: '#A1A1AA', bg: 'rgba(255,255,255,0.05)' }
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} • ${time}`
}

export default function FeedRow({
  type = 'default',
  title,
  detail,
  timestamp,
  pillTone,
  pillLabel,
  onTap
}) {
  const Icon = ICONS[type] || ICONS.default
  const tone = TONE[type] || TONE.default
  const interactive = !!onTap

  const Tag = interactive ? motion.button : motion.div
  const tagProps = interactive
    ? { type: 'button', whileTap: { scale: 0.99 }, onClick: () => { hapticTap(); onTap() } }
    : {}

  return (
    <Tag
      {...tagProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
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
          borderRadius: 11,
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
            fontSize: 13,
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
            fontSize: 11,
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
    </Tag>
  )
}
