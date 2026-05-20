/**
 * StampNumber — canonical Bebas Neue + tabular-nums numeric.
 *
 * The "money font" pattern used app-wide (Pipeline hero, KPIs,
 * job amounts, balances). Replaces inline `style={{ fontFamily:
 * 'var(--font-display)', fontVariantNumeric: 'tabular-nums', ... }}`
 * blocks scattered across screens.
 *
 * Sizes (closely match the prototype's stamp scale):
 *   xs  → 14px   metadata
 *   sm  → 18px   row amount
 *   md  → 22px   list summary
 *   lg  → 28px   KPI tile
 *   xl  → 40px   secondary hero
 *   2xl → 56px   primary hero (Pipeline card, Outstanding balance)
 *   3xl → 72px   maximum — use sparingly
 *
 * Tone variants:
 *   default → text
 *   muted   → text-muted
 *   gold    → primary gold
 *   success → moss green
 *   danger  → brick red
 *
 * Usage:
 *   <StampNumber size="2xl">$136,000</StampNumber>
 *   <StampNumber size="lg" tone="gold">11</StampNumber>
 *   <StampNumber size="sm" tone="muted">$24K</StampNumber>
 */
import type { HTMLAttributes, ElementType } from 'react'

type StampSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
type StampTone = 'default' | 'muted' | 'gold' | 'success' | 'danger'

const SIZE_PX: Record<StampSize, number> = {
  xs:  14,
  sm:  18,
  md:  22,
  lg:  28,
  xl:  40,
  '2xl': 56,
  '3xl': 72
}

const TONE_COLOR: Record<StampTone, string> = {
  default: 'var(--v3-text)',
  muted:   'var(--v3-text-muted)',
  gold:    'var(--v3-primary)',
  success: 'var(--v3-success-bright)',
  danger:  'var(--v3-danger-bright)'
}

type StampNumberProps = HTMLAttributes<HTMLElement> & {
  size?: StampSize
  tone?: StampTone
  as?: ElementType
}

export default function StampNumber({
  children,
  size = 'md',
  tone = 'default',
  as: Component = 'span',
  className,
  style,
  ...rest
}: StampNumberProps) {
  const px = SIZE_PX[size] ?? SIZE_PX.md

  return (
    <Component
      className={className}
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 400,
        fontSize: px,
        lineHeight: 0.95,
        letterSpacing: px >= 40 ? '-0.005em' : '0.005em',
        fontVariantNumeric: 'tabular-nums',
        fontFeatureSettings: '"tnum", "lnum"',
        color: TONE_COLOR[tone] || TONE_COLOR.default,
        ...style
      }}
      {...rest}
    >
      {children}
    </Component>
  )
}
