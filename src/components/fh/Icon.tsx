import type { LucideIcon, LucideProps } from 'lucide-react'

// One wrapper for every lucide icon in the redesign (spec 5.8): 1.75
// stroke, round caps and joins, and three sizes. Icons are decorative
// by default; give the control around them an aria-label instead.
export type IconSize = 18 | 22 | 24

type IconProps = Omit<LucideProps, 'ref' | 'size' | 'strokeWidth'> & {
  icon: LucideIcon
  size?: IconSize
}

export default function Icon({ icon: Glyph, size = 22, ...rest }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    />
  )
}
