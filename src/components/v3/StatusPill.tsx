/**
 * StatusPill — unified status badge primitive (Phase V3-JOBS-1).
 *
 * One pill family for every status badge across the app: stage
 * (lead/quote/job/invoice/closed/lost), top-deal (gold), approved
 * (green check), cold (danger). Same shape, same padding, same
 * font — only the tone color varies.
 *
 * Replaces the prior mix of:
 *   • StagePill inline in JobCard
 *   • Top Deal gold-gradient chip with bold caps + drop shadow
 *   • Various ad-hoc colored chips on Pipeline Preview
 *
 * Mockup-canonical layout (matches FH v3): chip is small, calm,
 * letter-spaced uppercase. Tone telegraphs the meaning; chrome
 * never competes with the rest of the card.
 *
 * @param {object} props
 * @param {'lead'|'quote'|'job'|'invoice'|'closed'|'lost'|'topDeal'|'approved'|'cold'} props.tone
 * @param {string} [props.label]   visible label; if omitted, derived from tone
 * @param {React.ComponentType} [props.icon]  optional 9px icon, lucide-react
 * @param {string} [props.className]
 * @param {object} [props.style]   merged onto the pill's wrapper
 */
import { Check, Snowflake, Star } from 'lucide-react'
import type { HTMLAttributes, ComponentType } from 'react'

type StatusTone = 'lead' | 'quote' | 'job' | 'invoice' | 'closed' | 'lost' | 'topDeal' | 'approved' | 'cold'

const TONE: Record<StatusTone, { color: string; label: string; Icon?: ComponentType<any> }> = {
  lead:     { color: 'var(--v3-stage-lead)',       label: 'Lead' },
  quote:    { color: 'var(--v3-stage-quote)',      label: 'Quote' },
  job:      { color: 'var(--v3-stage-active)',     label: 'Job' },
  invoice:  { color: 'var(--v3-stage-won)',        label: 'Invoice' },
  closed:   { color: 'var(--v3-success-bright)',   label: 'Closed' },
  lost:     { color: 'var(--v3-text-muted)',       label: 'Lost' },
  topDeal:  { color: 'var(--v3-primary)',          label: 'Top Deal',  Icon: Star },
  approved: { color: 'var(--v3-success-bright)',   label: 'Approved',  Icon: Check },
  cold:     { color: 'var(--v3-danger-bright)',    label: 'Cold',      Icon: Snowflake }
}

type StatusPillProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone
  label?: import('react').ReactNode
  icon?: ComponentType<any>
}

export default function StatusPill({
  tone = 'lead',
  label,
  icon: IconOverride,
  className,
  style,
  ...rest
}: StatusPillProps) {
  const cfg = TONE[tone] || TONE.lead
  const text = label || cfg.label
  const IconCmp = IconOverride || cfg.Icon

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: IconCmp ? 5 : 0,
        padding: '3px 9px',
        borderRadius: 999,
        background: `color-mix(in srgb, ${cfg.color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${cfg.color} 35%, transparent)`,
        color: `color-mix(in srgb, ${cfg.color} 80%, white 20%)`,
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...style
      }}
      {...rest}
    >
      {IconCmp ? <IconCmp size={9} aria-hidden="true" /> : null}
      {text}
    </span>
  )
}
