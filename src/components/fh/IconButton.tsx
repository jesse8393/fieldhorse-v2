import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, Ref } from 'react'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import Icon from './Icon.tsx'
import type { IconSize } from './Icon.tsx'
import { cx } from './cx.ts'

// Icon only button (spec section 7): 44 or 48 px, round or rounded square
// (radius 12). The accessible name is required by the type, because an
// icon alone tells a screen reader nothing.
//
// * plain: no fill, a faint wash on hover.
// * paper: paper with a hairline edge, for plaster grounds.
// * onyx: translucent dark with a linen icon and linen focus ring, for
//   photo headers and onyx surfaces (the back and more buttons in g-job).

export type IconButtonVariant = 'plain' | 'paper' | 'onyx'
export type IconButtonShape = 'round' | 'square'
export type IconButtonSize = 44 | 48

export type IconButtonOwnProps = {
  /** Required: what the button does, such as "Back to jobs". */
  'aria-label': string
  icon: LucideIcon
  size?: IconButtonSize
  shape?: IconButtonShape
  variant?: IconButtonVariant
  iconSize?: IconSize
  className?: string
}

export type IconButtonAsButtonProps = IconButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof IconButtonOwnProps | 'children'> & { to?: undefined }
export type IconButtonAsLinkProps = IconButtonOwnProps &
  Omit<LinkProps, keyof IconButtonOwnProps | 'children'> & { to: LinkProps['to'] }

export type IconButtonProps = IconButtonAsButtonProps | IconButtonAsLinkProps

const IconButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, IconButtonProps>(function IconButton(props, ref) {
  const { icon, size = 48, shape = 'round', variant = 'plain', iconSize = 22, className, ...rest } = props
  const classes = cx(
    'fhc-iconbtn',
    `fhc-iconbtn--${variant}`,
    `fhc-iconbtn--${shape}`,
    size === 44 ? 'fhc-iconbtn--44' : 'fhc-iconbtn--48',
    className
  )
  const glyph = <Icon icon={icon} size={iconSize} />

  if (rest.to !== undefined) {
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} {...(rest as Omit<IconButtonAsLinkProps, keyof IconButtonOwnProps>)} aria-label={props['aria-label']} className={classes}>
        {glyph}
      </Link>
    )
  }

  const { type = 'button', ...buttonRest } = rest as Omit<IconButtonAsButtonProps, keyof IconButtonOwnProps>
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} {...buttonRest} aria-label={props['aria-label']} className={classes}>
      {glyph}
    </button>
  )
})

export default IconButton
