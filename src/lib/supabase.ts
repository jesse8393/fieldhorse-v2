import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

const env = (import.meta as any).env
const url = env.VITE_SUPABASE_URL as string
const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY) as string
export const isSupabaseConfigured = Boolean(url && key)

if (!isSupabaseConfigured) {
  console.warn('[fieldhorse] Missing Supabase env vars. Copy .env.example to .env.local.')
}

// Active workspace. A user can belong to more than one org, and the
// database stamps new rows with an org when the insert leaves org_id
// empty (fh_set_org_id). MembershipContext keeps this in step with the
// org the UI is showing, and every PostgREST request carries it in the
// x-fh-org-id header so the trigger stamps that org (after checking the
// caller really is an active member of it). Auth, storage and edge
// function requests are left alone.
export const ACTIVE_ORG_HEADER = 'x-fh-org-id'

let activeOrgId: string | null = null

export function setActiveOrgId(orgId: string | null) {
  activeOrgId = orgId || null
}

export function getActiveOrgId(): string | null {
  return activeOrgId
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

// A REST read with no answer is abandoned after this long, so a screen
// shows its error and Try again instead of "Loading" for good on a weak
// signal (audit S23). Reads only (GET and HEAD under /rest/v1/): a write,
// an upload, an RPC or a sign in may take as long as it needs. The clock
// stops once the server starts answering, so a large page that arrives
// slowly is never cut off; only a read with no answer at all is.
export const READ_TIMEOUT_MS = 15_000

function isRestRead(url: string, method: string): boolean {
  const verb = method.toUpperCase()
  return url.includes('/rest/v1/') && (verb === 'GET' || verb === 'HEAD')
}

function readTimedOut(): DOMException {
  // An AbortError, so supabase-js answers at once with an error (status 0)
  // instead of retrying, and worded as a lost connection (isNetworkError).
  return new DOMException(`Network request failed: no answer in ${READ_TIMEOUT_MS / 1000} seconds`, 'AbortError')
}

function withReadTimeout(outer: AbortSignal | null | undefined, send: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController()
  // The caller's own cancel still works, for the whole response.
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason)
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true })
  }
  const timer = setTimeout(() => controller.abort(readTimedOut()), READ_TIMEOUT_MS)
  return send(controller.signal).finally(() => clearTimeout(timer))
}

function sendWithActiveOrg(input: RequestInfo | URL, init: RequestInit | undefined, url: string, isRequest: boolean): Promise<Response> {
  const orgId = activeOrgId
  if (!orgId || !url.includes('/rest/v1/')) return fetch(input, init)
  const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined))
  headers.set(ACTIVE_ORG_HEADER, orgId)
  return fetch(input, { ...init, headers })
}

export function fetchWithActiveOrg(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input)
  const isRequest = typeof Request !== 'undefined' && input instanceof Request
  const method = init?.method ?? (isRequest ? (input as Request).method : 'GET')
  if (!isRestRead(url, method)) return sendWithActiveOrg(input, init, url, isRequest)
  const outer = init?.signal ?? (isRequest ? (input as Request).signal : null)
  return withReadTimeout(outer, (signal) => sendWithActiveOrg(input, { ...init, signal }, url, isRequest))
}

// Password reset and email confirmation links use the implicit flow, so
// the session (access and refresh token) arrives in the URL fragment.
// auth-js clears it by assigning location.hash, which pushes a new
// history entry and leaves the tokenized URL one Back press (or a synced
// history) away. auth-js calls this right after parsing the fragment and
// never reads the URL again, so the current entry can be swapped for the
// same URL without it; the later hash clear then has nothing to do.
// Same answer as auth-js's default check otherwise.
let pendingAuthFragment: { path: string; hash: string } | null = null

export function detectSessionInUrl(current: URL, params: Record<string, string>): boolean {
  if (params.access_token) {
    try {
      const path = `${current.pathname}${current.search}`
      window.history.replaceState(window.history.state, '', path)
      pendingAuthFragment = { path, hash: current.hash }
    } catch { /* auth-js still clears the fragment itself */ }
  }
  return Boolean(params.access_token || params.error_description)
}

export const supabase = createClient<Database>(
  url || 'https://missing-supabase-url.supabase.co',
  key || 'missing-supabase-anon-key',
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl
  },
  global: {
    fetch: fetchWithActiveOrg
  }
  }
)

// If the link could not be turned into a session (no signal while it
// opened, say), put the fragment back so a reload can try again instead
// of the user needing a new email.
if (typeof window !== 'undefined') {
  void supabase.auth.initialize().then(({ error }) => {
    const taken = pendingAuthFragment
    pendingAuthFragment = null
    if (!error || !taken || window.location.hash) return
    if (`${window.location.pathname}${window.location.search}` !== taken.path) return
    try {
      window.history.replaceState(window.history.state, '', `${taken.path}${taken.hash}`)
    } catch { /* a fresh link from the email still works */ }
  }, () => { /* auth-js reports its own failures */ })
}

// Bearer header for Netlify function calls that require the signed-in
// user's access token (/api/send-*, /api/claude). Returns {} when no
// session exists so callers fail on the server with a clean 401 instead
// of throwing here.
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
