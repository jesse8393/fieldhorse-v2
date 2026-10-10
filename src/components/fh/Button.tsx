import { forwardRef } from 'react'
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  MouseEvent,
  ReactNode,
  Ref
} from 'react'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import Icon from './Icon.tsx'
import { cx } from './cx.ts'

// The redesign button (spec section 7).
//
// * primary: brushed gold with a lit top edge, text in --fh-on-gold in
//   both themes. One per screen.
// * secondary: paper with an edge outline. Outlined linen on onyx.
// * quiet: text only.
// * destructive: danger ink text and a faint danger outline. Keep it
//   apart from the other actions in the layout.
//
// Sizes: lg 56 tall (radius 14), md 48 (radius 12), mini 36 with a
// 44 px hit area. Loading draws a skeleton bar in place of the label,
// never a spinner, keeps the button's width and sets aria-busy.
// With `to` it renders a react-router Link, with `href` a plain <a>.

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive'
export type ButtonSize = 'lg' | 'md' | 'mini'

export type ButtonOwnProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Skeleton bar instead of the label; the button keeps its width and ignores presses. */
  loading?: boolean
  /** Full width of the container. */
  block?: boolean
  /** Leading icon. */
  icon?: LucideIcon
  /** Trailing icon, such as an arrow on "Navigate". */
  trailingIcon?: LucideIcon
  children: ReactNode
  className?: string
}

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps>
type NativeAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps | 'href'>

export type ButtonAsButtonProps = ButtonOwnProps & NativeButtonProps & { to?: undefined; href?: undefined }
export type ButtonAsLinkProps = ButtonOwnProps &
  Omit<LinkProps, keyof ButtonOwnProps> & { to: LinkProps['to']; href?: undefined; disabled?: boolean }
export type ButtonAsAnchorProps = ButtonOwnProps &
  NativeAnchorProps & { href: string; to?: undefined; disabled?: boolean }

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps | ButtonAsAnchorProps

const ICON_SIZE = { lg: 22, md: 18, mini: 18 } as const

const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    icon,
    trailingIcon,
    children,
    className,
    ...rest
  } = props

  const iconSize = ICON_SIZE[size]
  const classes = cx(
    'fhc-btn',
    `fhc-btn--${variant}`,
    `fhc-btn--${size}`,
    block && 'fhc-btn--block',
    loading && 'is-loading',
    className
  )
  const content = (
    <>
      <span className="fhc-btn__label">
        {icon && <Icon icon={icon} size={iconSize} />}
        <span className="fhc-btn__text">{children}</span>
        {trailingIcon && <Icon icon={trailingIcon} size={iconSize} />}
      </span>
      {loading && <span className="fhc-btn__skel" aria-hidden="true" />}
    </>
  )

  // Links: a disabled link has no href and leaves the tab order; a loading
  // link stays focusable but ignores presses.
  if (rest.to !== undefined || rest.href !== undefined) {
    const { disabled = false, onClick, ...linkRest } = rest as (ButtonAsLinkProps | ButtonAsAnchorProps) & { onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }
    const inert = disabled || loading
    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
      if (inert) {
        e.preventDefault()
        return
      }
      onClick?.(e)
    }
    const shared = {
      className: cx(classes, disabled && 'is-disabled'),
      'aria-disabled': inert ? true : undefined,
      'aria-busy': loading ? true : undefined,
      onClick: handleClick
    }
    if (disabled) {
      const { to: _to, href: _href, replace: _replace, state: _state, relative: _relative, preventScrollReset: _psr, reloadDocument: _rd, viewTransition: _vt, ...plain } =
        linkRest as Partial<ButtonAsLinkProps> & Partial<ButtonAsAnchorProps>
      return (
        <a ref={ref as Ref<HTMLAnchorElement>} role="link" {...(plain as NativeAnchorProps)} {...shared}>
          {content}
        </a>
      )
    }
    if (linkRest.to !== undefined) {
      return (
        <Link ref={ref as Ref<HTMLAnchorElement>} {...(linkRest as Omit<ButtonAsLinkProps, keyof ButtonOwnProps>)} {...shared}>
          {content}
        </Link>
      )
    }
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} {...(linkRest as Omit<ButtonAsAnchorProps, keyof ButtonOwnProps>)} {...shared}>
        {content}
      </a>
    )
  }

  const { type = 'button', disabled, onClick, ...buttonRest } = rest as ButtonAsButtonProps
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type={type}
      disabled={disabled}
      {...buttonRest}
      className={classes}
      aria-busy={loading ? true : undefined}
      // Loading keeps focus where it is (a disabled button would drop it)
      // and swallows presses instead.
      aria-disabled={loading ? true : buttonRest['aria-disabled']}
      onClick={(e) => {
        if (loading) {
          e.preventDefault()
          return
        }
        onClick?.(e)
      }}
    >
      {content}
    </button>
  )
})

export default Button
