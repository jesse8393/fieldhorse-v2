import { memo } from 'react'
import { motion } from 'framer-motion'
import { Users as UsersIcon, ArrowUpRight } from 'lucide-react'
import { STAGE_MAP, margin, marginTier } from '../../lib/stages.js'
import { hapticTap } from '../../lib/haptics.js'

// Stage progression visual (lost collapses to 0). Same constants Jobs.jsx
// has used; centralized here so JobCard owns the per-card visual maths.
const STAGE_STEP = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const TOTAL_STAGES = 5

// Stage-driven "next action" hint shown beneath the stage pill. Mirrors the
// pipeline.js stage default suggestions so the operator sees the same
// primary action they'd see in the Job Detail NextActionCard.
const NEXT_ACTION_HINT = {
  lead:    'Send a quote',
  quote:   'Get approval',
  job:     'Job in progress',
  invoice: 'Awaiting payment',
  closed:  null,
  lost:    null
}

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
  photoUrl, // optional — backend wiring to fh_photos comes later
  featured = false // top-value/most-urgent: gold border + TOP DEAL chip
}) {
  const stageMeta = STAGE_MAP[contact.stage]
  const stageColor = stageMeta?.color || '#5C5C5C'
  const step = STAGE_STEP[contact.stage] ?? 0
  const progressPct = (step / TOTAL_STAGES) * 100
  const m = margin(contact)
  const hasCost = Number(contact.cost || 0) > 0
  const isSharedIn = !!viewerUserId && !!contact.user_id && contact.user_id !== viewerUserId

  const nextHint = NEXT_ACTION_HINT[contact.stage]

  // Photo banner mode — when a photo is present, render it as a
  // full-width 140px cover banner at the top of the card instead of
  // a 56x56 thumbnail in the body row. Mockup-tier: photo earns
  // its space when present.
  const hasPhotoBanner = !!photoUrl

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
      whileTap={{ scale: 0.97 }}
      whileHover={{
        y: -4,
        backgroundColor: '#2A2620',
        boxShadow: featured
          ? '0 24px 56px rgba(0, 0, 0, 0.65), 0 6px 18px rgba(229, 193, 88, 0.22)'
          : '0 24px 56px rgba(0, 0, 0, 0.65), 0 6px 18px rgba(0, 0, 0, 0.40)'
      }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: hasPhotoBanner ? 12 : 14,
        width: '100%',
        boxSizing: 'border-box',
        // Photo banner sits flush at the top, so banner mode skips
        // top padding. Spine moves to the left edge of the card body.
        padding: hasPhotoBanner ? '0 18px 18px' : '18px 18px 18px 22px',
        borderRadius: 'var(--v3-radius-card)',
        background: '#171511', // literal so framer hover transition is smooth
        border: featured
          ? '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)'
          : '1px solid rgba(255, 255, 255, 0.22)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden',
        boxShadow: featured
          ? '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 1px 2px rgba(0, 0, 0, 0.34), 0 8px 24px rgba(0, 0, 0, 0.30), 0 4px 16px rgba(229, 193, 88, 0.14)'
          : '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 1px 2px rgba(0, 0, 0, 0.34), 0 8px 24px rgba(0, 0, 0, 0.30)'
      }}
    >
      {/* Photo cover banner (only when photo present). Renders flush
          at the top of the card with overlays: TOP DEAL chip if
          featured + initial chip + stage spine running down the
          left edge of the card body below. */}
      {hasPhotoBanner && (
        <div
          aria-hidden="true"
          style={{
            position: 'relative',
            width: '100%',
            height: 140,
            overflow: 'hidden',
            background: 'var(--v3-surface-2)'
          }}
        >
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {/* Bottom gradient — keeps overlays + name below readable */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, transparent 40%, rgba(11, 10, 8, 0.85) 100%)',
            pointerEvents: 'none'
          }} />
          {/* Initial chip overlay */}
          <span style={{
            position: 'absolute',
            left: 10,
            top: 10,
            minWidth: 26,
            height: 26,
            padding: '0 8px',
            borderRadius: 8,
            background: `linear-gradient(135deg, ${stageColor}EE, ${stageColor}CC)`,
            color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            letterSpacing: '0.04em',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            boxShadow: '0 4px 10px rgba(0, 0, 0, 0.40)'
          }}>
            {initials(contact.name)}
          </span>
          {/* TOP DEAL chip when featured */}
          {featured && (
            <span style={{
              position: 'absolute',
              right: 10,
              top: 10,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
              color: 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              lineHeight: 1.2,
              boxShadow: '0 0 0 2px rgba(229, 193, 88, 0.18), 0 4px 10px rgba(229, 193, 88, 0.35), 0 1px 0 rgba(255, 255, 255, 0.30) inset'
            }}>
              Top Deal
            </span>
          )}
        </div>
      )}

      {/* Stage-color spine — left-edge accent. Adjusted for banner
          mode (sits below the banner) vs no-banner mode (full height). */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0,
        top: hasPhotoBanner ? 152 : 14,
        bottom: 12,
        width: 4,
        background: `linear-gradient(180deg, ${stageColor}, color-mix(in srgb, ${stageColor} 55%, transparent))`,
        borderRadius: '0 4px 4px 0',
        pointerEvents: 'none'
      }} />

      {/* Top edge gradient stroke — only in non-banner mode (the
          banner has its own visual leading edge). */}
      {!hasPhotoBanner && (
        <span aria-hidden="true" style={{
          position: 'absolute',
          top: 0,
          left: '14%',
          right: '14%',
          height: 1,
          background: featured
            ? 'linear-gradient(90deg, transparent 0%, rgba(229, 193, 88, 0.55) 50%, transparent 100%)'
            : 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.20) 50%, transparent 100%)',
          pointerEvents: 'none'
        }} />
      )}

      {/* TOP DEAL chip for non-banner cards — sits in the corner */}
      {featured && !hasPhotoBanner && (
        <span style={{
          position: 'absolute',
          right: 12,
          top: 12,
          padding: '3px 9px',
          borderRadius: 999,
          background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
          color: 'var(--v3-on-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          lineHeight: 1.2,
          boxShadow: '0 0 0 2px rgba(229, 193, 88, 0.18), 0 4px 10px rgba(229, 193, 88, 0.35), 0 1px 0 rgba(255, 255, 255, 0.30) inset',
          pointerEvents: 'none'
        }}>
          Top Deal
        </span>
      )}

      {/* Top row: photo/initial tile + name block + amount block.
          When the banner is rendered, the inline photo tile is
          omitted and the name/amount sit at the top of the body. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, marginTop: hasPhotoBanner ? 14 : 0 }}>
        {!hasPhotoBanner && (
          <PhotoOrInitialTile
            photoUrl={photoUrl}
            name={contact.name}
            stageColor={stageColor}
          />
        )}
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
            fontSize: 26,
            letterSpacing: '-0.005em',
            color: Number(contact.amount || 0) > 0 ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
            textShadow: Number(contact.amount || 0) > 0
              ? '0 2px 12px rgba(229, 193, 88, 0.32)'
              : 'none'
          }}>
            {money(contact.amount)}
          </div>
          <MarginBadge pct={m} hasCost={hasCost} />
        </div>
      </div>

      {/* NEXT ACTION HINT — stage-driven hint that mirrors what JobDetail's
          NextActionCard would surface. Helps the operator scan the list and
          see "what's blocking this job?" without opening it. */}
      {nextHint && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 8,
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)',
          alignSelf: 'flex-start',
          maxWidth: '100%'
        }}>
          <ArrowUpRight size={11} color="var(--v3-primary)" aria-hidden="true" />
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: 'var(--v3-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            Next: {nextHint}
          </span>
        </div>
      )}

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

      {/* Progress bar — thicker (4px) + subtle stage-colored glow so the
          progression is readable at a glance from across a 3-col grid. */}
      <div style={{
        position: 'relative',
        height: 4,
        borderRadius: 999,
        background: 'var(--v3-track)',
        overflow: 'hidden'
      }}>
        <span style={{
          position: 'absolute',
          inset: 0,
          width: `${progressPct}%`,
          background: stageColor,
          borderRadius: 999,
          boxShadow: `0 0 10px ${stageColor}66`,
          transition: 'width 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'
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
          color: 'var(--v3-on-primary)',
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
