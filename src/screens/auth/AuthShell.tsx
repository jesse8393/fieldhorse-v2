// The one stage the signed out screens share (spec 9.1, decision D11):
// Login, ResetPassword and PartnerInvite. Always onyx with grain, whatever
// Day or Night says, so it carries .fh-onyx-scope: linen text, the linen
// focus ring and the onyx field colors all come from the scope.
//
// The FIELDHORSE wordmark sits at the top of the column. When
// public/welcome.jpg exists, the top 55 percent shows it fading into onyx;
// until Jesse supplies a photo the stage is onyx with grain only, and a
// missing file never shows a broken image box.
//
// On a phone the soft keyboard must not cover the button: while a field has
// focus, the shell scrolls the screen's main action (the element marked
// data-fha-primary) into the visual viewport.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { cx } from '../../components/fh/cx.ts'
import './auth.css'

export const WELCOME_PHOTO = '/welcome.jpg'

// One probe per page load, so remounting a screen never asks again and a
// missing file costs one request, not a loop. The browser decodes the file
// before it counts as found, so a host that answers a missing path with the
// app's own index.html (a single page app fallback) is treated as missing.
let photoProbe: Promise<boolean> | null = null

function probeWelcomePhoto(): Promise<boolean> {
  if (!photoProbe) {
    photoProbe = new Promise<boolean>((resolve) => {
      const probe = new Image()
      probe.onload = () => resolve(probe.naturalWidth > 0)
      probe.onerror = () => resolve(false)
      probe.src = WELCOME_PHOTO
    })
  }
  return photoProbe
}

function useWelcomePhoto() {
  const [found, setFound] = useState(false)
  useEffect(() => {
    let current = true
    void probeWelcomePhoto().then((ok) => {
      if (current) setFound(ok)
    })
    return () => {
      current = false
    }
  }, [])
  return found
}

// Pad the page by the keyboard's height and keep the main action in the
// visual viewport. iOS and Android keep the layout viewport the size it was
// and shrink only the visual one, so ask the visual viewport, not the window.
function useKeyboardReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    const viewport = window.visualViewport
    if (!root || !viewport) return
    let timer: number | undefined

    const measure = () => {
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      root.style.setProperty('--fha-kbd', covered > 40 ? `${Math.round(covered)}px` : '0px')
    }

    const reveal = () => {
      measure()
      const field = document.activeElement
      if (!(field instanceof HTMLInputElement) || !root.contains(field)) return
      const action = root.querySelector<HTMLElement>('[data-fha-primary]')
      if (!action) return
      const visibleBottom = viewport.offsetTop + viewport.height - 12
      const hidden = action.getBoundingClientRect().bottom - visibleBottom
      if (hidden <= 0) return
      // Never scroll the focused field itself out of sight at the top.
      const room = field.getBoundingClientRect().top - (viewport.offsetTop + 8)
      const by = Math.min(hidden, room)
      if (by <= 0) return
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' })
    }

    const later = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(reveal, ms)
    }
    const onResize = () => {
      measure()
      later(60)
    }
    // The keyboard slides up for about 300 ms; look again once it has.
    const onFocusIn = () => later(320)

    measure()
    viewport.addEventListener('resize', onResize)
    viewport.addEventListener('scroll', measure)
    root.addEventListener('focusin', onFocusIn)
    return () => {
      window.clearTimeout(timer)
      viewport.removeEventListener('resize', onResize)
      viewport.removeEventListener('scroll', measure)
      root.removeEventListener('focusin', onFocusIn)
      root.style.removeProperty('--fha-kbd')
    }
  }, [rootRef])
}

const FIELD_LETTERS = 'FIELD'.split('')
const HORSE_LETTERS = 'HORSE'.split('')

function Wordmark() {
  return (
    <div className="fha-wordmark" role="img" aria-label="Fieldhorse">
      {FIELD_LETTERS.map((letter, index) => (
        <span key={`f${index}`} className="fha-wordmark__field" aria-hidden="true">{letter}</span>
      ))}
      {HORSE_LETTERS.map((letter, index) => (
        <span key={`h${index}`} className="fha-wordmark__horse" aria-hidden="true">{letter}</span>
      ))}
    </div>
  )
}

export type AuthShellProps = {
  /** Id of the h1 inside, which names the main landmark. */
  labelledBy: string
  /** Paint the stage only, while the session is still being read. */
  loading?: boolean
  children?: ReactNode
}

export default function AuthShell({ labelledBy, loading = false, children }: AuthShellProps) {
  const rootRef = useRef<HTMLElement>(null)
  const hasPhoto = useWelcomePhoto()
  useKeyboardReveal(rootRef)

  return (
    <main
      ref={rootRef}
      className={cx('fha fh-onyx-scope fh-grain', hasPhoto && 'fha--photo')}
      aria-labelledby={loading ? undefined : labelledBy}
      aria-busy={loading || undefined}
    >
      {hasPhoto && (
        <div className="fha-hero" aria-hidden="true">
          <img className="fha-hero__img" src={WELCOME_PHOTO} alt="" decoding="async" />
        </div>
      )}
      {!loading && (
        <div className="fha__body">
          <div className="fha__col">
            <Wordmark />
            {children}
          </div>
        </div>
      )}
    </main>
  )
}
