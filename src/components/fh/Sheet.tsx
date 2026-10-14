import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Drawer } from 'vaul'
import { X } from 'lucide-react'
import { freePageForQuestion, useConfirm } from '../ConfirmSheet.tsx'
import IconButton from './IconButton.tsx'
import { cx } from './cx.ts'

// Bottom sheet (spec 7 and 9.5), built on vaul: a paper surface with a
// grabber and 22 px top corners, rising in 280 ms and leaving in 180 ms
// (--dur-sheet-in and --dur-sheet-out; fades only under reduced motion).
// Swipe down, Escape, a tap on the dimmed page or the close button all
// close it, and with `dirty` each of those asks first through the app's
// ConfirmSheet (useConfirm). The bottom edge clears the home indicator.
//
// When it closes, focus goes back to the control that opened it (Phase 8,
// Task 15). The sheets are opened from the app's own state, not a vaul
// Trigger, so Radix had no trigger to return to and focus fell to the page
// body: a keyboard or screen reader user lost their place every time. The
// sheet remembers what had focus as it opened and focuses it again once it
// has gone, if that control is still in the page and focus has not moved
// on somewhere else meanwhile (another sheet, a new screen).
//
// The discard question is drawn at the app root, so it would outlive the
// sheet. When the sheet closes or leaves the page while it asks (the back
// button), the question goes too, answered no, and the sheet's pointer
// lock is only put back while the sheet is still there: written back after
// the sheet had gone, it left every tap on the next screen dead.
//
// `title` is the dialog's accessible name; `description` its description.
// Children can ask to close (with the same dirty check) through useSheet.

export type SheetDiscardCopy = {
  title?: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
}

export type SheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The sheet's title, read as the dialog's accessible name. */
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Actions pinned under the scrolling body, such as Save and Cancel. */
  footer?: ReactNode
  /** A control beside the title, such as a quiet "Done". */
  headerAction?: ReactNode
  /** The close button beside the title. On unless headerAction is given. */
  closeButton?: boolean
  /** Unsaved changes: ask before any close. */
  dirty?: boolean
  /** Wording for the discard question. */
  discard?: SheetDiscardCopy
  /** Portal target. Defaults to document.body. */
  container?: HTMLElement | null
  className?: string
}

type ConfirmOptions = {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  signal?: AbortSignal
}
type Confirm = (options: ConfirmOptions) => Promise<boolean>

type SheetContextValue = {
  /** Close the sheet, asking first when it has unsaved changes. */
  requestClose: () => void
}

const SheetContext = createContext<SheetContextValue | null>(null)

/** For content inside a Sheet: close it the same way the grabber would. */
export function useSheet(): SheetContextValue {
  const ctx = useContext(SheetContext)
  if (!ctx) throw new Error('useSheet must be used inside a Sheet')
  return ctx
}

const DISCARD_DEFAULTS: Required<SheetDiscardCopy> = {
  title: 'Discard your changes?',
  body: 'What you entered here is not saved yet.',
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing'
}

export default function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerAction,
  closeButton,
  dirty = false,
  discard,
  container,
  className
}: SheetProps) {
  const confirm = useConfirm() as Confirm
  const contentRef = useRef<HTMLDivElement>(null)
  const askingRef = useRef(false)
  // The discard question while it is open, taken back if the sheet closes
  // or leaves the page meanwhile.
  const askAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    if (!open) return
    return () => askAbortRef.current?.abort()
  }, [open])
  // What had focus as the sheet opened, read while rendering the open
  // (before the sheet takes focus), to give focus back when it closes.
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  if (open && !wasOpenRef.current && typeof document !== 'undefined') {
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
  }
  wasOpenRef.current = open
  // Read at call time, so a close attempt sees the latest dirty flag.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const copyRef = useRef(discard)
  copyRef.current = discard

  const requestClose = useCallback(async () => {
    if (!dirtyRef.current) {
      onOpenChange(false)
      return
    }
    if (askingRef.current) return
    askingRef.current = true

    const node = contentRef.current
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // A swipe that let go past the close point leaves the sheet part way
    // down while it asks; bring it back up.
    if (node) {
      node.style.transition = 'transform var(--dur-sheet-in) var(--ease-out)'
      node.style.transform = 'translate3d(0, 0, 0)'
      // The sheet's focus trap would pull focus back from the question;
      // an inert sheet lets the question hold it.
      node.setAttribute('inert', '')
    }
    // A modal sheet turns off pointer events on the page; the question is
    // rendered on the page, so it needs them back while it is open.
    const lockPageAgain = freePageForQuestion(node)
    const asking = new AbortController()
    askAbortRef.current = asking

    let discarded = false
    try {
      // Ask after the event that asked to close has finished. Escape is
      // handled while it is still on its way through the document, and
      // the question listens for Escape on the document as well; asked
      // at once, the same key press would also cancel the question.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      const copy = { ...DISCARD_DEFAULTS, ...copyRef.current }
      discarded = await confirm({ ...copy, destructive: true, signal: asking.signal })
    } finally {
      if (askAbortRef.current === asking) askAbortRef.current = null
      askingRef.current = false
      node?.removeAttribute('inert')
    }

    if (discarded) {
      onOpenChange(false)
      return
    }
    lockPageAgain()
    // Taken back because the sheet closed or left: nowhere to go back to.
    if (asking.signal.aborted) return
    // Back to where they were.
    requestAnimationFrame(() => {
      const target = contentRef.current
      if (!target) return
      if (returnTo && target.contains(returnTo)) returnTo.focus()
      else target.focus()
    })
  }, [confirm, onOpenChange])

  const context = useMemo(() => ({ requestClose: () => void requestClose() }), [requestClose])
  const showClose = closeButton ?? headerAction == null
  const hasDescription = description != null && description !== false

  // While the question is open, nothing outside the sheet may close it.
  const holdWhileAsking = (event: Event) => {
    if (askingRef.current) event.preventDefault()
  }

  // Once the sheet has gone, focus the control that opened it, if it is
  // still in the page and focus did not move on to something else (it
  // falls to the body when the focused sheet leaves the page).
  const returnFocus = (event: Event) => {
    const opener = openerRef.current
    openerRef.current = null
    if (!opener || !opener.isConnected) return
    const active = document.activeElement
    const content = contentRef.current
    if (active && active !== document.body && !(content && content.contains(active))) return
    event.preventDefault()
    opener.focus({ preventScroll: true })
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else void requestClose()
      }}
    >
      <Drawer.Portal container={container ?? undefined}>
        <Drawer.Overlay className="fhc-sheet-overlay" />
        <Drawer.Content
          ref={contentRef}
          className={cx('fhc-sheet', footer != null && 'has-footer', className)}
          {...(hasDescription ? {} : { 'aria-describedby': undefined })}
          // Focus the sheet itself, not its first field, so opening it
          // never pops the keyboard on a phone.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          onEscapeKeyDown={holdWhileAsking}
          onInteractOutside={holdWhileAsking}
          onCloseAutoFocus={returnFocus}
        >
          <SheetContext.Provider value={context}>
            <div className="fhc-sheet__grabber" aria-hidden="true" />
            <div className="fhc-sheet__head">
              <div className="fhc-sheet__titlebar">
                <Drawer.Title className="fhc-sheet__title">{title}</Drawer.Title>
                {headerAction}
                {showClose && (
                  <IconButton
                    className="fhc-sheet__close"
                    aria-label="Close"
                    icon={X}
                    size={44}
                    onClick={() => void requestClose()}
                  />
                )}
              </div>
              {hasDescription && (
                <Drawer.Description className="fhc-sheet__desc">{description}</Drawer.Description>
              )}
            </div>
            <div className="fhc-sheet__body">{children}</div>
            {footer != null && <div className="fhc-sheet__foot">{footer}</div>}
          </SheetContext.Provider>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
