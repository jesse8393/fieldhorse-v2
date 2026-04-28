import { memo } from 'react'
import { motion } from 'framer-motion'
import { Users as UsersIcon } from 'lucide-react'
import { STAGE_MAP, margin, marginTier } from '../../lib/stages.js'
import { hapticTap } from '../../lib/haptics.js'

// Stage progression visual (lost collapses to 0). Same constants Jobs.jsx
// has used; centralized here so JobCard owns the per-card visual maths.
const STAGE_STEP = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const TOTAL_STAGES = 5

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function initials(name) {
  if (!name) return '—'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

function MarginBadge({ pct, hasCost }) {
  if (!hasCost) {
    return (
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.02em',
        color: 'var(--v3-text-muted)',
        fontVariantNumeric: 'tabular-nums'
      }}>
        Margin —
      </span>
    )
  }
  const tier = marginTier(pct)
  const color = tier === 'good' ? '#4ADE80' : tier === 'warn' ? '#E8C25A' : '#F47366'
  return (
    <span style={{
      fontFamily: 'var(--font-body)',
      fontSize: 11,
      fontWeight: 700,
      color,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1
    }}>
      Margin {pct.toFixed(0)}%
    </span>
  )
}

function StagePill({ stageId }) {
  const meta = STAGE_MAP[stageId]
  if (!meta) return null
  const color = meta.color
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 9px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      color: `color-mix(in srgb, ${color} 80%, white 20%)`,
      fontFamily: 'var(--font-body)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      lineHeight: 1.4
    }}>
      {meta.label}
    </span>
  )
}

/**
 * v3 JobCard — premium pipeline card.
 *
 * Layout (matches mockup):
 *   ┌─────────────────────────────────────────────┐
 *   │ ╔══════╗  Name              $24,400        │
 *   │ ║ PHOTO║  Sub line          Margin 24%     │
 *   │ ║  +MA ║  👥 CLIENT NAME                    │
 *   │ ╚══════╝                                    │
 *   │ [QUOTE]              Stage 2/5              │
 *   │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━           │
 *   └─────────────────────────────────────────────┘
 *
 * - photo: optional cover image URL. Falls back to stage-tinted initial tile.
 * - 3D tilt removed — perf win, mockup doesn't call for it.
 * - React.memo — kills re-renders when parent list updates unrelated rows.
 */
const JobCard = memo(function JobCard({
  contact,
  index = 0,
  isNew = false,
  viewerUserId,
  onOpen,
  photoUrl // optional — backend wiring to fh_photos comes later
}) {
  const stageMeta = STAGE_MAP[contact.stage]
  const stageColor = stageMeta?.color || '#5C5C5C'
  const step = STAGE_STEP[contact.stage] ?? 0
  const progressPct = (step / TOTAL_STAGES) * 100
  const m = margin(contact)
  const hasCost = Number(contact.cost || 0) > 0
  const isSharedIn = !!viewerUserId && !!contact.user_id && contact.user_id !== viewerUserId

  return (
    <motion.button
      type="button"
      layout
      onClick={() => { hapticTap(); onOpen?.(contact) }}
      initial={isNew ? { opacity: 0, scale: 0.94 } : { opacity: 0, y: 8 }}
      animate={isNew ? { opacity: 1, scale: [0.94, 1.02, 1] } : { opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={isNew
        ? { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
        : { duration: 0.22, delay: Math.min(index * 0.035, 0.22), ease: [0.2, 0.8, 0.2, 1] }
      }
      whileTap={{ scale: 0.99 }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%',
        boxSizing: 'border-box',
        padding: '14px',
        borderRadius: 'var(--v3-radius-card)',
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* Top row: photo/initial tile + name block + amount block */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
        <PhotoOrInitialTile
          photoUrl={photoUrl}
          name={contact.name}
          stageColor={stageColor}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--v3-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.2
          }}>
            {contact.name || 'Untitled'}
          </div>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--v3-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.3
          }}>
            {contact.job_title || contact.job_type || 'No job title'}
          </div>
          {(contact.fh_clients?.name && !isSharedIn) && (
            <div style={{
              marginTop: 2,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-body)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--v3-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              lineHeight: 1.4
            }}>
              <UsersIcon size={9} />
              {contact.fh_clients.name}
            </div>
          )}
          {isSharedIn && (
            <div style={{
              marginTop: 2,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-body)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--v3-primary)',
              lineHeight: 1.4
            }}>
              <UsersIcon size={9} />
              Shared
            </div>
          )}
        </div>
        <div style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
          paddingTop: 1
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 19,
            letterSpacing: '0.01em',
            color: Number(contact.amount || 0) > 0 ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1
          }}>
            {money(contact.amount)}
          </div>
          <MarginBadge pct={m} hasCost={hasCost} />
        </div>
      </div>

      {/* Bottom row: stage pill + stage X/5 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <StagePill stageId={contact.stage} />
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: 'var(--v3-text-muted)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          Stage {step}/{TOTAL_STAGES}
        </span>
      </div>

      {/* Progress bar — thin, stage-colored. Matches the v2 visual treatment
          but reads quieter (no glow) so the pill carries the stage signal. */}
      <div style={{
        position: 'relative',
        height: 3,
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.05)',
        overflow: 'hidden'
      }}>
        <span style={{
          position: 'absolute',
          inset: 0,
          width: `${progressPct}%`,
          background: stageColor,
          borderRadius: 999,
          transition: 'width 240ms cubic-bezier(0.2, 0.8, 0.2, 1)'
        }} />
      </div>
    </motion.button>
  )
})

/**
 * Cover photo with stage-tinted initial fallback.
 * 56×56 thumbnail. Shows initials inside a stage-tinted gradient when no
 * photo URL is present, matching the existing v2 avatar treatment.
 */
function PhotoOrInitialTile({ photoUrl, name, stageColor }) {
  const SIZE = 56
  if (photoUrl) {
    return (
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: SIZE,
          height: SIZE,
          borderRadius: 12,
          overflow: 'hidden',
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border)',
          position: 'relative'
        }}
      >
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {/* Initial chip overlay — keeps card scan-able even with photo */}
        <span style={{
          position: 'absolute',
          left: 4,
          top: 4,
          minWidth: 22,
          height: 22,
          padding: '0 6px',
          borderRadius: 6,
          background: `linear-gradient(135deg, ${stageColor}EE, ${stageColor}CC)`,
          color: '#0B0B0D',
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: '0.04em',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1
        }}>
          {initials(name)}
        </span>
      </div>
    )
  }
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: SIZE,
        height: SIZE,
        borderRadius: 12,
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        letterSpacing: '0.04em',
        background: `linear-gradient(135deg, ${stageColor}33, ${stageColor}11)`,
        color: stageColor,
        border: `1px solid ${stageColor}33`
      }}
    >
      {initials(name)}
    </div>
  )
}

export default JobCard
