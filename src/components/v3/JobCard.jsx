import { memo } from 'react'
import { motion } from 'framer-motion'
import { Users as UsersIcon, ArrowUpRight } from 'lucide-react'
import { STAGE_MAP, margin, marginTier } from '../../lib/stages.ts'
import { hapticTap } from '../../lib/haptics.js'
import StatusPill from './StatusPill.jsx'

// Cold threshold (V3-JOBS-1) — a contact in lead or quote stage with no
// updated_at activity for at least 7 days reads as cold. Mirrors the
// Home Next-Actions cold-lead threshold so the two surfaces stay aligned.
const COLD_DAYS = 7
const COLD_MS = COLD_DAYS * 24 * 60 * 60 * 1000

function isColdContact(contact) {
  if (!contact) return false
  if (contact.stage !== 'lead' && contact.stage !== 'quote') return false
  const ts = contact.updated_at || contact.created_at
  if (!ts) return false
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return false
  return Date.now() - t >= COLD_MS
}

// Stage progression visual (lost collapses to 0). Same constants Jobs.jsx
// has used; centralized here so JobCard owns the per-card visual maths.
const STAGE_STEP = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const TOTAL_STAGES = 5

// Stage-driven "next action" hint shown beneath the stage pill. Mirrors the
// pipeline.ts stage default suggestions so the operator sees the same
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
  // No cost data → hide the row entirely. The previous "Margin —"
  // placeholder added visual noise without conveying anything.
  if (!hasCost) return null
  const tier = marginTier(pct)
  const color = tier === 'good'
    ? 'var(--v3-success-bright)'
    : tier === 'warn'
      ? 'var(--v3-warn)'
      : 'var(--v3-danger-bright)'
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

// V3-JOBS-1: local StagePill removed — replaced app-wide by the
// shared StatusPill primitive (src/components/v3/StatusPill.jsx)
// so all status badges (stage / Top Deal / Approved / Cold) share
// one chip family.

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
      className={`fh-job-card${hasPhotoBanner ? ' fh-job-card--with-photo' : ''}${featured ? ' fh-job-card--featured' : ''}`}
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
        backgroundColor: 'var(--v3-surface-3)',
        // V3-JOBS-1: featured cards drop the gold halo on hover.
        // Gold border alone marks the Top Deal — halo was decoration.
        boxShadow: '0 24px 56px rgba(0, 0, 0, 0.65), 0 6px 18px rgba(0, 0, 0, 0.40)'
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
        // Subtle vertical gradient — top edge a touch lighter than the
        // base so the card reads as a lifted glass panel catching light
        // from above, not a flat black rectangle. Featured cards get a
        // faint warm wash.
        background: featured
          ? 'linear-gradient(180deg, #1f1a12 0%, #141110 60%)'
          : 'linear-gradient(180deg, #1a1715 0%, #121010 70%)',
        // V3-JOBS-1: card border demoted to matte hairline (matches
        // V3-HOME-1 pass). Featured cards keep a functional gold border
        // to telegraph Top Deal status without halo decoration.
        border: featured
          ? '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)'
          : '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden',
        // Layered depth: warm inner top-edge highlight + tight contact
        // shadow + mid spread + wide ambient. Reads as dimensional.
        boxShadow: '0 1px 0 rgba(255, 240, 210, 0.06) inset, 0 1px 2px rgba(0, 0, 0, 0.40), 0 6px 16px rgba(0, 0, 0, 0.40), 0 18px 40px rgba(0, 0, 0, 0.28)'
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

      {/* Stage-color spine — V3-JOBS-1: softened from 4px×full-height
          gradient to 3px×~28mm flat at 70% tone. Mirrors the Home
          Pipeline Preview row treatment so list surfaces stay
          consistent. Stage signal still present, no longer reads
          as a colored card outline. */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0,
        top: hasPhotoBanner ? 158 : 22,
        height: 28,
        width: 3,
        background: `color-mix(in srgb, ${stageColor} 70%, transparent)`,
        borderRadius: '0 2px 2px 0',
        pointerEvents: 'none'
      }} />

      {/* V3-JOBS-1: removed the decorative top-edge gradient stroke.
          The matte hairline border + spine + bottom progress bar
          carry the visual rhythm without the extra ornament. */}

      {/* TOP DEAL chip for non-banner cards — placed at the top of the
          name column inline so it never collides with the amount on
          the right. Renders below as part of the name block, not as
          an absolutely-positioned corner overlay. */}

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
          {/* V3-JOBS-1: Top Deal chip moved into the unified status
              row at the bottom (rendered via StatusPill). The inline
              gold-gradient chip above the name is retired in favor
              of the consistent pill family. */}
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
          background: 'var(--v3-surface-2)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
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

      {/* Bottom row: unified status pills (mockup-canonical stage
          chip + V3-JOBS-1 added Top Deal / Approved / Cold) on the
          left, Stage X/5 numeric on the right.  All chips now share
          the StatusPill family — same shape, padding, font; only
          tone color differs. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill tone={stageToneFor(contact.stage)} label={STAGE_MAP[contact.stage]?.label || contact.stage} />
          {featured && (
            <StatusPill tone="topDeal" />
          )}
          {contact.proposal_status === 'approved' && (
            <StatusPill tone="approved" />
          )}
          {isColdContact(contact) && (
            <StatusPill tone="cold" />
          )}
        </div>
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

      {/* Progress bar — V3-JOBS-1: removed the stage-color glow ring;
          flat 4px filled track only. Mockup-canonical thin progress
          signal stays. */}
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
          transition: 'width 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'
        }} />
      </div>
    </motion.button>
  )
})

// Map a stage id to a StatusPill tone. Lost folds into the muted
// 'lost' tone; everything else has its own canonical tone variant.
function stageToneFor(stageId) {
  switch (stageId) {
    case 'lead':    return 'lead'
    case 'quote':   return 'quote'
    case 'job':     return 'job'
    case 'invoice': return 'invoice'
    case 'closed':  return 'closed'
    case 'lost':    return 'lost'
    default:        return 'lead'
  }
}

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
