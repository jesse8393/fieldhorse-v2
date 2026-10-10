import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Moon, Plus } from 'lucide-react'
import Icon from './Icon.tsx'
import { DOCK_LEFT, DOCK_RIGHT, TODAY, isActive, type NavItem } from '../../lib/navItems.ts'
import { useNavAccess } from '../../lib/useNavAccess.ts'
import { useDockHidden } from '../../lib/dockVisibility.ts'
import { useKeyboardOpen } from '../../lib/useKeyboardOpen.ts'
import { useTheme } from '../../contexts/ThemeContext.tsx'
import { hapticMedium } from '../../lib/haptics.ts'
import { prefetchRoute } from '../../lib/routePrefetch.ts'

// The phone dock (spec 8.1): a floating onyx capsule with Today, Jobs,
// the brushed gold Capture coin, Money and Schedule. Items follow the
// role filter and the coin stays centered on whatever remains. Hidden
// at desktop widths (the sidebar takes over), while the keyboard is
// open, and on screens that carry their own action capsule.
//
// Portaled to body: screens animate with transforms, which would
// otherwise re-anchor position: fixed.

function DockItem({ item, pathname, night }: { item: NavItem; pathname: string; night: boolean }) {
  const active = isActive(item, pathname)
  // Today shows the moon after sunset, as in the night render.
  const glyph = item === TODAY && night ? Moon : item.icon
  return (
    <Link
      to={item.to}
      className={`fhs-dock__item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onPointerEnter={() => prefetchRoute(item.to)}
      onFocus={() => prefetchRoute(item.to)}
    >
      <Icon icon={glyph} size={22} />
      <span className="fhs-dock__label">{item.label}</span>
      <span className="fhs-dock__dot" aria-hidden="true" />
    </Link>
  )
}

export default function Dock() {
  const { pathname } = useLocation()
  const { canSee } = useNavAccess()
  const { theme } = useTheme()
  const hiddenByScreen = useDockHidden()
  const keyboardOpen = useKeyboardOpen()

  if (typeof document === 'undefined') return null

  const left = DOCK_LEFT.filter((it) => canSee(it.to))
  const right = DOCK_RIGHT.filter((it) => canSee(it.to))
  const hidden = hiddenByScreen || keyboardOpen
  const night = theme === 'dark'

  const dock = (
    <nav
      className={`fhs-dock fh-onyx-scope${hidden ? ' is-hidden' : ''}`}
      aria-label="Primary"
    >
      <div className="fhs-dock__side">
        {left.map((item) => <DockItem key={item.to} item={item} pathname={pathname} night={night} />)}
      </div>
      <div className="fhs-dock__center">
        <button
          type="button"
          className="fhs-dock__coin"
          aria-label="Capture a note, photo, lead or payment"
          title="Capture (⌘J)"
          onClick={() => {
            hapticMedium()
            window.dispatchEvent(new CustomEvent('fh:open-capture'))
          }}
        >
          <Icon icon={Plus} size={24} />
        </button>
        <span className="fhs-dock__label fhs-dock__label--coin" aria-hidden="true">Capture</span>
      </div>
      <div className="fhs-dock__side">
        {right.map((item) => <DockItem key={item.to} item={item} pathname={pathname} night={night} />)}
      </div>
    </nav>
  )

  return createPortal(dock, document.body)
}
