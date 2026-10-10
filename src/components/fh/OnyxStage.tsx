import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx.ts'

// The one dark band per screen (spec section 7): onyx in both themes, 3
// percent grain on its own layer, an optional warm glow at the top right
// and a 1 px gold hairline closing it at the bottom. Everything inside
// reads the onyx text tokens and the linen focus ring through
// .fh-onyx-scope, so components placed on it need no changes.

export type OnyxStageProps = {
  /** Warm gold glow from the top right corner. */
  glow?: boolean
  /** The 1 px gold hairline at the bottom. On by default. */
  hairline?: boolean
  as?: 'section' | 'header' | 'div'
  children?: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'>

export default function OnyxStage({
  glow = false,
  hairline = true,
  as: Tag = 'section',
  children,
  className,
  ...rest
}: OnyxStageProps) {
  return (
    <Tag
      {...rest}
      className={cx(
        'fhc-stage fh-onyx-scope fh-grain',
        glow && 'fhc-stage--glow',
        hairline && 'fhc-stage--hairline',
        className
      )}
    >
      {children}
    </Tag>
  )
}
