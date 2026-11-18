import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Moon, Plus } from 'lucide-react'
import Icon from './Icon.tsx'
import { DOCK_LEFT, INBOX, TODAY, dockRight, isActive, type NavItem } from '../../lib/navItems.ts'
import { useEngineEnabled } from '../../lib/inbox.ts'
import { useNavAccess } from '../../lib/useNavAccess.ts'
import { useDockHidden } from '../../lib/dockVisibility.ts'
import { useKeyboardOpen } from '../../lib/useKeyboardOpen.ts'
import { useTheme } from '../../contexts/ThemeContext.tsx'
import { hapticMedium } from '../../lib/haptics.ts'
import { prefetchRoute } from '../../lib/routePrefetch.ts'
import { openCapture } from '../../lib/captureAttach.ts'
import { browserEnv, desktopShortcut } from '../../lib/shortcutKeys.ts'

// The phone dock (spec 8.1): a floating onyx capsule with Today, Jobs,
// the brushed gold Capture coin, Money and Schedule. The fifth slot is
// Inbox instead of Schedule once the company's messaging engine is on and
// the role may open it (decision D9). Items follow the role filter and the
// coin stays centered on whatever remains. Hidden
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

// The labels give way first. When one no longer fits beside its
// neighbours (zoom, or the phone's text made bigger) the dock shows its
// icons alone, so no tab is pushed off the screen. Each label stays in the
// page as its tab's name. A label is measured at its own width, centered
// on its tab, whether it is showing or not, so the choice never flips.
function labelsCollide(nav: HTMLElement) {
  const box = nav.getBoundingClientRect()
  const spans = Array.from(nav.querySelectorAll<HTMLElement>('.fhs-dock__label'), (label) => {
    const holder = (label.parentElement ?? label).getBoundingClientRect()
    const middle = holder.left + holder.width / 2
    return { left: middle - label.scrollWidth / 2, right: middle + label.scrollWidth / 2 }
  }).sort((a, b) => a.left - b.left)
  // Closer than 6 px, two labels read as one ("MoneySchedule").
  return spans.some((span, i) => span.left < box.left + 2 || span.right > box.right - 2 || (i > 0 && span.left < spans[i - 1].right + 6))
}

// `tabs` names the tabs shown: the labels are watched again only when
// that set changes, not on every render. Size, zoom and text size changes
// reach the watcher on their own.
function useIconsOnly(tabs: string) {
  const ref = useRef<HTMLElement | null>(null)
  const [iconsOnly, setIconsOnly] = useState(false)
  useLayoutEffect(() => {
    const nav = ref.current
    if (!nav) return
    const check = () => setIconsOnly(labelsCollide(nav))
    check()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(check)
    observer.observe(nav)
    nav.querySelectorAll('.fhs-dock__label').forEach((label) => observer.observe(label))
    return () => observer.disconnect()
  }, [tabs])
  return { ref, iconsOnly }
}

export default function Dock() {
  const { pathname } = useLocation()
  const { canSee } = useNavAccess()
  const { theme } = useTheme()
  const hiddenByScreen = useDockHidden()
  const keyboardOpen = useKeyboardOpen()
  const engineEnabled = useEngineEnabled()
  const left = DOCK_LEFT.filter((it) => canSee(it.to))
  // A role that cannot open the Inbox keeps Schedule in the fifth slot.
  const right = dockRight(engineEnabled && canSee(INBOX.to)).filter((it) => canSee(it.to))
  const { ref, iconsOnly } = useIconsOnly([...left, ...right].map((it) => it.to).join(' '))

  if (typeof document === 'undefined') return null

  const hidden = hiddenByScreen || keyboardOpen
  const night = theme === 'dark'
  const captureShortcut = desktopShortcut('J', browserEnv())
  // With no company role nothing here opens (dead-ends-2): no dock.
  const canCapture = canSee('/capture')
  if (!left.length && !right.length && !canCapture) return null

  const dock = (
    <nav
      ref={ref}
      className={`fhs-dock${hidden ? ' is-hidden' : ''}${iconsOnly ? ' is-icons-only' : ''}`}
      aria-label="Primary"
    >
      <div className="fhs-dock__side">
        {left.map((item) => <DockItem key={item.to} item={item} pathname={pathname} night={night} />)}
      </div>
      {canCapture && <div className="fhs-dock__center">
        <button
          type="button"
          className="fhs-dock__coin"
          aria-label="Capture a note, photo or update"
          title={`Capture (${captureShortcut.keys})`}
          aria-keyshortcuts={captureShortcut.combo}
          onClick={() => {
            hapticMedium()
            openCapture()
          }}
        >
          <Icon icon={Plus} size={24} />
        </button>
        <span className="fhs-dock__label fhs-dock__label--coin" aria-hidden="true">Capture</span>
      </div>}
      <div className="fhs-dock__side">
        {right.map((item) => <DockItem key={item.to} item={item} pathname={pathname} night={night} />)}
      </div>
    </nav>
  )

  return createPortal(dock, document.body)
}
