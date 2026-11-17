// Public messages describe recovery without exposing provider or database details.
import { reportClientError } from './reportClientError.ts'

type ServiceError = { message?: unknown; code?: unknown; status?: unknown }

// ─── plainError: the one way a screen words a failure ────────────────────
//
// A screen never shows a database, gateway, browser or provider message, a
// bare code or an HTML page. plainError sorts whatever was thrown into the
// few kinds a person can act on and says what to do next, or gives the
// caller's own sentence, which names the action ("Could not save the job.").
// The raw value still goes to the console and the crash reporter for us.

export type ErrorKind = 'offline' | 'session' | 'permission' | 'conflict' | 'busy' | 'server' | 'unknown'

const SAY: Record<Exclude<ErrorKind, 'unknown' | 'offline'>, string> = {
  session: 'Your sign in ran out. Sign in again, then try again.',
  permission: 'Your role does not allow this. Ask an owner or admin.',
  conflict: 'This was already saved. Refresh to see the latest.',
  busy: 'Too many tries at once. Wait a minute, then try again.',
  server: 'Something went wrong on our side. Try again in a minute.'
}
const OFFLINE = 'No signal right now. Try again when the signal is back.'
const OFFLINE_KEPT = 'No signal right now. Your work is still here, so try again when the signal is back.'

// Codes our Netlify functions and Supabase auth return, by what they mean.
const CODE_KIND: Record<string, ErrorKind> = {
  invalid_token: 'session', missing_token: 'session', not_authenticated: 'session', unauthorized: 'session',
  bad_jwt: 'session', session_expired: 'session', session_not_found: 'session', refresh_token_not_found: 'session',
  refresh_token_already_used: 'session', no_authorization: 'session',
  insufficient_role: 'permission', forbidden: 'permission', forbidden_or_not_found: 'permission',
  role_exceeds_caller: 'permission', member_exceeds_caller: 'permission', forbidden_path: 'permission',
  path_not_owned: 'permission', no_membership: 'permission', membership_revoked: 'permission',
  rate_limited: 'busy', too_many_messages: 'busy', over_request_rate_limit: 'busy',
  over_email_send_rate_limit: 'busy', over_sms_send_rate_limit: 'busy',
  method_not_allowed: 'server', upstream_failed: 'server', request_failed: 'server', unexpected_failure: 'server'
}

// Codes with a sentence of their own. A function's own plain sentence wins
// over these, except where the function's text can be a provider's words or
// setup notes for us (UNTRUSTED_DETAIL).
const CODE_SAYS: Record<string, string> = {
  // Supabase auth, for sign in, sign up and password reset.
  invalid_credentials: 'Wrong email or password.',
  email_not_confirmed: 'Confirm your email first. The link is in your inbox.',
  user_already_exists: 'There is already an account with this email. Sign in instead.',
  email_exists: 'There is already an account with this email. Sign in instead.',
  weak_password: 'Pick a longer password with letters and numbers.',
  same_password: 'Pick a password you have not used here before.',
  signup_disabled: 'New accounts cannot be made right now. Try again later.',
  email_address_invalid: 'Check the email address and try again.',
  validation_failed: 'Check the email and password, then try again.',
  // Our functions.
  send_failed: 'The email did not go out. Try again, or download the PDF and send it yourself.',
  sender_not_configured: 'Email sending is not set up for this company yet.',
  esign_not_configured: 'E-signature is not set up for this company yet. Send the quote link instead.',
  server_misconfigured: 'This is not available right now. Try again later.',
  missing_api_key: 'This is not available right now. Try again later.',
  billing_review_unavailable: 'This is not available right now. Try again later.',
  invalid_rate: 'Enter an hourly rate from 0 to 10,000.',
  rate_required: 'Enter an hourly rate.',
  contract_billing_exceeded: 'This would bill more than the contract allows. Lower the amount or void unused drafts.',
  last_owner: 'A company needs at least one owner. Make someone else owner first.',
  cannot_remove_self: 'You cannot remove yourself. Ask another owner to do it.',
  transfer_ownership_required: 'Make someone else owner first.',
  invalid_email: 'Check the email address and try again.',
  invalid_role: 'Pick a role from the list.',
  email_mismatch: 'This invite was sent to a different email. Sign in with that email.',
  email_unconfirmed: 'Confirm your email first. The link is in your inbox.',
  no_auth_email: 'Your account has no email yet. Add one in Settings.',
  no_company: 'Set up your company first.',
  no_linked_contractor: 'Accept a job invite from your contractor first.',
  gone: 'This link no longer works. Ask for a new one.',
  expired: 'This link has expired. Ask for a new one.',
  revoked: 'This link no longer works. Ask for a new one.',
  quote_expired: 'This quote has expired. Ask for an updated one.',
  invite_expired: 'This invite has expired. Ask for a new one.',
  invite_revoked: 'This invite was cancelled. Ask for a new one.',
  invite_already_used: 'This invite was already used.',
  invite_not_found: 'This invite could not be found. Ask for a new one.',
  already_accepted: 'This was already accepted.',
  already_approved: 'This was already approved.',
  not_approvable: 'This can no longer be approved.',
  not_found: 'This could not be found. It may have been removed.',
  member_not_found: 'This person is no longer on the team. Refresh the list.',
  invoice_void: 'This invoice was voided.',
  invoice_changed: 'This invoice changed since it was opened. Refresh and try again.',
  document_changed: 'This changed since it was opened. Refresh and try again.',
  payload_too_large: 'That is too large to send. Make it smaller and try again.',
  body_too_long: 'That message is too long. Shorten it and try again.',
  name_too_long: 'That name is too long. Shorten it and try again.',
  unsupported_type: 'Upload a PDF, JPG or PNG file.',
  pdf_download_failed: 'The PDF could not be read, so nothing was sent. Try again.',
  docusign_auth_failed: 'E-signature could not connect. Send the quote link instead.',
  envelope_create_failed: 'The signing request could not be made. Try again in a few minutes.'
}

// The function's text for these can be a provider's words or setup notes
// meant for us, so the code's own sentence is always used.
const UNTRUSTED_DETAIL = new Set(['send_failed', 'server_misconfigured', 'missing_api_key', 'sender_not_configured', 'esign_not_configured', 'missing_token', 'invalid_token', 'forbidden', 'forbidden_path'])

const NETWORK = /failed to fetch|networkerror|network ?error|load failed|network request failed|fetch failed|err_internet|err_network|internet connection appears to be offline|the network connection was lost/i
const SESSION = /jwt|refresh token|auth session missing|session (has )?expired|not authenticated/i
const PERMISSION = /row-level security|permission denied|insufficient[_ ]privilege/i
const CONFLICT = /duplicate key|already exists/i
const HTML = /^\s*<|<html|<!doctype/i
const SERVER = /bad gateway|service unavailable|gateway time-?out|internal server error|cloudflare|upstream|statement timeout|timed? ?out|^http_5\d\d$/i
const SERVER_CODES = new Set(['57014', '53300', '53400', '08000', '08001', '08003', '08006', 'XX000', 'PGRST000', 'PGRST001', 'PGRST002'])
const SESSION_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303'])
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/

type Fields = { name: string; message: string; code: string; status: number; fnCode: string; said: string; provider: boolean; plainError: boolean }

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function fieldsOf(error: unknown): Fields {
  if (typeof error === 'string') return { name: '', message: error, code: '', status: 0, fnCode: SNAKE.test(error) ? error : '', said: '', provider: false, plainError: false }
  if (!error || typeof error !== 'object') return { name: '', message: '', code: '', status: 0, fnCode: '', said: '', provider: false, plainError: false }
  const e = error as Record<string, unknown>
  const message = text(e.message) || text(e.msg) || text(e.error_description)
  const code = text(e.code) || text(e.error_code)
  const status = Number(e.status) || Number(e.statusCode) || Number(e.status_code) || 0
  // A function body is { error: 'code', message?, detail? }; orgApi and the
  // senders throw an Error whose message is the code and keep the sentence
  // on .detail.
  const fnCode = SNAKE.test(text(e.error)) ? text(e.error) : SNAKE.test(message) ? message : SNAKE.test(code) ? code : ''
  const said = text(e.detail) || (SNAKE.test(text(e.error)) ? message : '')
  return {
    name: text(e.name),
    message,
    code,
    status,
    fnCode,
    said,
    provider: e.provider_status != null,
    // Our own Errors and their subclasses keep the name Error; the
    // browser's and the libraries' carry their own (TypeError, AuthApiError).
    // A bare { message } is not ours: postgrest builds one from any text
    // answer, so our libraries answer with an Error instead.
    plainError: error instanceof Error && error.name === 'Error' && !code && !status
  }
}

/**
 * A sentence the app wrote, safe to show: starts with a capital, ends with a
 * full stop, and has no code, address, markup or setup words in it.
 */
export function isPlainSentence(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const s = value.trim()
  if (s.length < 4 || s.length > 240) return false
  if (!/^[A-Z]/.test(s) || !/[.?]$/.test(s)) return false
  return !/[<>{}`|\\]|https?:|www\.|\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b|\bHTTP\b|\bBearer\b|\bNetlify\b|\bSupabase\b|\bResend\b|\benv\b|\bAPI\b|\bJWT\b|\bJSON\b|\bnull\b|\bundefined\b|\bfh_|Error:|TypeError|Unknown/.test(s)
}

/** Which of the few failures a person can act on this is. */
export function errorKind(error: unknown): ErrorKind {
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return 'offline'
  const f = fieldsOf(error)
  // A sentence we wrote ourselves is never read for failure words: "The
  // upload timed out on our side." is not a lost signal.
  if (f.plainError && isPlainSentence(f.message)) return 'unknown'
  const blob = `${f.name} ${f.message}`
  if (!f.status && !f.code && !HTML.test(f.message) && (NETWORK.test(blob) || /RetryableFetchError|FetchError|FunctionsFetchError/.test(f.name))) return 'offline'
  const byCode = CODE_KIND[f.fnCode] || CODE_KIND[f.code]
  if (byCode) return byCode
  if (f.status === 401 || SESSION_CODES.has(f.code) || /AuthSessionMissingError|AuthInvalidJwtError/.test(f.name) || SESSION.test(f.message)) return 'session'
  if (f.code === '42501' || f.status === 403 || PERMISSION.test(f.message)) return 'permission'
  if (f.code === '23505' || f.status === 409 || CONFLICT.test(f.message)) return 'conflict'
  if (f.status === 429 || /too many requests|rate limit/i.test(f.message)) return 'busy'
  if (f.status >= 500 || f.name === 'TimeoutError' || SERVER_CODES.has(f.code) || HTML.test(f.message) || SERVER.test(f.message) || /_failed$/.test(f.fnCode)) return 'server'
  return 'unknown'
}

const logged = new WeakSet<object>()

function logRaw(error: unknown, f: Fields, fallback: string) {
  if (error == null) return
  // A sentence we wrote ourselves is not a failure to look into.
  if (f.plainError && isPlainSentence(f.message)) return
  if (typeof error === 'object') {
    if (logged.has(error)) return
    logged.add(error)
  }
  // eslint-disable-next-line no-console
  console.warn('[fieldhorse]', fallback, error)
  // A function's answer is a plain object: report its code and words.
  const summary = [f.fnCode || f.code, f.status || '', f.message || f.said].filter(Boolean).join(' ')
  reportClientError('mutation', error instanceof Error ? error : summary || fallback)
}

/**
 * The sentence a screen shows for a failure. `fallback` is the caller's own
 * sentence naming the action, used when the failure is none of the kinds
 * below. Pass `kept: true` where what the person typed is still on screen.
 */
export function plainError(error: unknown, fallback: string, options: { kept?: boolean } = {}): string {
  const f = fieldsOf(error)
  logRaw(error, f, fallback)
  const kind = errorKind(error)
  if (kind === 'offline') return options.kept ? OFFLINE_KEPT : OFFLINE
  if (f.fnCode && !UNTRUSTED_DETAIL.has(f.fnCode) && !f.provider && isPlainSentence(f.said)) return f.said.trim()
  const coded = CODE_SAYS[f.fnCode] || CODE_SAYS[f.code]
  if (coded) return coded
  if (kind !== 'unknown') return SAY[kind]
  if (f.plainError && isPlainSentence(f.message)) return f.message.trim()
  return fallback
}

export function aiDraftError(error: unknown): string {
  const detail = error as ServiceError | null
  const code = String(detail?.code || detail?.message || '').toLowerCase()
  const status = Number(detail?.status)
  if (status === 401 || code.includes('invalid_token') || code.includes('missing_token')) {
    return 'Your session needs to reconnect before AI drafting can continue. Keep your message here and try again after reconnecting.'
  }
  if (status === 429) return 'AI drafting is busy. Keep writing your message and try again shortly.'
  if (code.includes('missing_api_key') || code.includes('server_misconfigured')) {
    return 'AI drafting is not ready for this workspace. You can write and send your own message below.'
  }
  if (code.includes('timed out') || code.includes('failed to fetch') || status === 404) {
    return 'AI drafting could not connect. Check your connection or keep writing your message below.'
  }
  return 'AI drafting is unavailable right now. Your message is still here. You can edit it or try again.'
}

export function teamLoadError(error: unknown): string {
  const detail = error as ServiceError | null
  if (detail?.message === 'server_misconfigured') {
    return 'Team access needs workspace setup before the roster can load. Contact your workspace administrator or support, then retry.'
  }
  if (Number(detail?.status) === 401) {
    return 'Your session needs to reconnect before the team roster can load. Reconnect and try again.'
  }
  if (Number(detail?.status) === 403) {
    return 'You do not have access to this team roster. Check your selected workspace or contact its administrator.'
  }
  return 'Could not load your team roster. Check your connection and try again.'
}
