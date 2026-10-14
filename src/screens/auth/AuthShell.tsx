// The one stage the signed out screens share (spec 9.1, decision D11):
// Login, ResetPassword and PartnerInvite. Always onyx with grain, whatever
// Day or Night says, so it carries .fh-onyx-scope: linen text, the linen
// focus ring and the onyx field colors all come from the scope.
//
// The FIELDHORSE wordmark sits at the top of the column, and waits, clear,
// for its face (Bebas Neue) so a wider fallback never runs off a phone. When
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

// Bebas Neue is far narrower than any face a browser falls back to: the
// fallback sets FIELDHORSE at 68 px about 430 px wide, off the edge of a
// phone. So the stage asks for the face as soon as it mounts, and the
// wordmark waits for it, clear, for up to 3 seconds (the wait browsers give
// font-display: block). A face that fails or comes later than that shows
// the fallback at a size that fits, and Bebas Neue takes over when it lands.
const WORDMARK_FAMILY = 'Bebas Neue'
const WORDMARK_FACE = `68px "${WORDMARK_FAMILY}"`
const WORDMARK_WAIT_MS = 3000

type WordmarkFace = 'waiting' | 'ready' | 'fallback'

// The wait runs once per page load. It ends 3 seconds after a stage first
// asks for the face, or as soon as the face fails, and a screen that mounts
// after that (Partner invite, then Sign in) shows the fallback at once
// instead of hiding the word for another wait.
let wordmarkWaitEnds = Number.POSITIVE_INFINITY

// Whether Bebas Neue has landed, asked of the face itself. Never of
// document.fonts.check(): WebKit, which runs Safari and every browser on an
// iPhone, answers it with true for a font-display: swap face from the moment
// its download starts, and again after the download fails. A face's status
// reads 'loaded' only once its file is in, in every engine.
function isLoadedWordmarkFace(face: FontFace) {
  return face.family.replace(/["']/g, '') === WORDMARK_FAMILY && face.status === 'loaded'
}

function wordmarkFaceNow(): WordmarkFace {
  // No font loading API (the unit test DOM, for one): nothing to wait for.
  if (typeof document === 'undefined' || !document.fonts) return 'ready'
  for (const face of document.fonts) {
    if (isLoadedWordmarkFace(face)) return 'ready'
  }
  return Date.now() >= wordmarkWaitEnds ? 'fallback' : 'waiting'
}

function useWordmarkFace(): WordmarkFace {
  const [face, setFace] = useState<WordmarkFace>(wordmarkFaceNow)
  const landed = face === 'ready'
  useEffect(() => {
    if (landed) return
    let current = true
    if (wordmarkWaitEnds === Number.POSITIVE_INFINITY) wordmarkWaitEnds = Date.now() + WORDMARK_WAIT_MS
    const timer = window.setTimeout(() => {
      if (current) setFace('fallback')
    }, Math.max(0, wordmarkWaitEnds - Date.now()))
    const settle = (next: WordmarkFace) => {
      window.clearTimeout(timer)
      if (next === 'fallback') wordmarkWaitEnds = Math.min(wordmarkWaitEnds, Date.now())
      if (current) setFace(next)
    }
    // Resolves once every matching face has loaded, with no faces if none
    // matched; rejects when the file fails. Ready only when each face it
    // hands back says it has loaded.
    document.fonts.load(WORDMARK_FACE, 'FIELDHORSE').then(
      (faces) => settle(faces.length > 0 && faces.every(isLoadedWordmarkFace) ? 'ready' : 'fallback'),
      () => settle('fallback')
    )
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [landed])
  return face
}

// FIELD in brushed gold and HORSE in linen, one word in Bebas Neue at one
// size, set tight, with the gold hairline under it (spec 9.1, the render
// glamor/g-welcome.jpg). Two spans, so each word takes its own color. While
// it waits for its face it stays in the accessibility tree, only clear.
function Wordmark({ face }: { face: WordmarkFace }) {
  return (
    <div
      className={cx('fha-wordmark', face !== 'ready' && `fha-wordmark--${face}`)}
      role="img"
      aria-label="Fieldhorse"
    >
      <span className="fha-wordmark__field" aria-hidden="true">FIELD</span>
      <span className="fha-wordmark__horse" aria-hidden="true">HORSE</span>
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
  // Here, not in Wordmark, so the face is on its way while the session is
  // still being read and the wordmark is not drawn yet.
  const wordmarkFace = useWordmarkFace()
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
            <Wordmark face={wordmarkFace} />
            {children}
          </div>
        </div>
      )}
    </main>
  )
}
