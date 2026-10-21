// What the command palette offers for the job that is highlighted
// (SPEC.md 9.12, PHASE4_PLAN.md Task 4.4). Pure: the palette passes the
// highlighted job and whether the role may move money, and gets back the
// rows of its Actions group. Where each row goes uses things the app
// already has:
//
//   invoice   the send invoice cue on the job page (opens the invoice screen)
//   message   the native text handoff (sms:) every other screen uses, or the
//             job page when there is no number to text
//   note      Universal Capture attached to the job (openCapture({ jobId }))
//   navigate  the same maps link the Today screen builds
//
// Keyboard: plain letters belong to the search field, so a shortcut is
// Alt plus the letter, or Control plus Option plus the letter on a Mac,
// where Option alone types a character (Option N starts ñ, Option M is µ).
// Control with Alt is never a shortcut elsewhere: on a Windows keyboard
// that is AltGr, which types characters too (D19). actionForShortcut() is
// the one place that rule lives, and CommandPalette draws the key caps
// from shortcutModifier() and shortcutCombo().

import { navigateHref } from './todayView.ts'
import { isMacLike } from './shortcutKeys.ts'
import { recordRoute } from './records.ts'

// The palette's actions belong to a job (fh_contacts). A lead, a quote or
// an invoice found by the search opens its own screen (D53) and has no
// action rows here.
export type PaletteJob = {
  id: string
  name: string
  job_title: string | null
  address: string | null
  stage: string
  /** Used by Message. Optional so callers that only know the basics still work. */
  phone?: string | null
}

export type PaletteActionId = 'invoice' | 'message' | 'note' | 'navigate'

export type PaletteAction = {
  id: PaletteActionId
  label: string
  /** The letter printed on the key cap, or null for no shortcut. */
  key: string | null
  /** An app route, or an external link (sms: or https:). */
  to?: string
  /** A window event to dispatch, with the job attached by the caller. */
  event?: string
}

export type PaletteEnv = { userAgent?: string; maxTouchPoints?: number }

const CAPTURE_EVENT = 'fh:open-capture'

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function paletteActions(
  job: PaletteJob | null,
  canMoney: boolean,
  env: PaletteEnv = {}
): PaletteAction[] {
  if (!job) return []

  const name = clean(job.name)
  const title = clean(job.job_title) || name
  const address = clean(job.address)
  const phone = clean(job.phone)
  const actions: PaletteAction[] = []

  if (canMoney && (job.stage === 'job' || job.stage === 'invoice')) {
    actions.push({
      id: 'invoice',
      label: `Create invoice for ${title}`,
      key: 'I',
      to: `${recordRoute('job', job.id)}?action=send_invoice`
    })
  }

  actions.push({
    id: 'message',
    label: `Message ${name}`,
    key: 'M',
    to: phone ? `sms:${phone}` : recordRoute('job', job.id)
  })

  actions.push({ id: 'note', label: `Add a note to ${title}`, key: 'N', event: CAPTURE_EVENT })

  if (address) {
    actions.push({
      id: 'navigate',
      label: `Navigate to ${address}`,
      key: null,
      to: navigateHref(address, env.userAgent ?? '', env.maxTouchPoints ?? 0)
    })
  }

  return actions
}

export type ShortcutKeys = {
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * The action a key press runs, or null. On a Mac, Control plus Option plus
 * the letter; elsewhere Alt plus the letter, and nothing else in either
 * case: a plain letter must always reach the search field, Option alone
 * types accents on a Mac, Control with Alt is AltGr on Windows, and Ctrl
 * or Cmd with I, M or N already mean something to the browser. `code` is
 * the physical key, so it holds on a Mac where Option changes the
 * character. With VoiceOver running, Control plus Option is VoiceOver's own
 * key and those presses never reach the page (Control Option M opens its
 * menu bar); its users reach the same actions as rows, with the arrows and
 * Enter (decision D19).
 */
export function actionForShortcut(actions: PaletteAction[], e: ShortcutKeys, env: PaletteEnv = {}): PaletteAction | null {
  if (!e.altKey || e.metaKey || e.shiftKey) return null
  if (e.ctrlKey !== isMacLike(env)) return null
  return actions.find((a) => a.key !== null && e.code === `Key${a.key}`) ?? null
}

/** The modifier as it is printed on the key cap: Control and Option on a Mac, Alt elsewhere. */
export function shortcutModifier(env: PaletteEnv = {}): string {
  return isMacLike(env) ? '⌃⌥' : 'Alt'
}

/** The aria-keyshortcuts value for an action's letter, such as "Control+Alt+N" on a Mac or "Alt+N". */
export function shortcutCombo(key: string, env: PaletteEnv = {}): string {
  return isMacLike(env) ? `Control+Alt+${key}` : `Alt+${key}`
}
