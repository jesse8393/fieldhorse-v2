type ScrollLockSnapshot = {
  scrollX: number
  scrollY: number
  htmlOverflow: string
  bodyOverflow: string
  bodyPosition: string
  bodyTop: string
  bodyLeft: string
  bodyRight: string
  bodyWidth: string
}

let lockCount = 0
let snapshot: ScrollLockSnapshot | null = null

/**
 * Lock the document behind a modal without losing its scroll position.
 * A reference count keeps overlapping sheets from unlocking each other.
 */
export function lockDocumentScroll() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  if (lockCount === 0) {
    const html = document.documentElement
    const body = document.body
    snapshot = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width
    }

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${snapshot.scrollY}px`
    body.style.left = `-${snapshot.scrollX}px`
    body.style.right = '0'
    body.style.width = '100%'
  }

  lockCount += 1
  let released = false

  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount > 0 || !snapshot) return

    const html = document.documentElement
    const body = document.body
    const restore = snapshot
    snapshot = null

    html.style.overflow = restore.htmlOverflow
    body.style.overflow = restore.bodyOverflow
    body.style.position = restore.bodyPosition
    body.style.top = restore.bodyTop
    body.style.left = restore.bodyLeft
    body.style.right = restore.bodyRight
    body.style.width = restore.bodyWidth
    window.scrollTo({ left: restore.scrollX, top: restore.scrollY, behavior: 'instant' })
  }
}
