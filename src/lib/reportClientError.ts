// Sends a short report of a browser error to /api/client-error, so a crash
// on a phone at a job site is seen by someone. See
// netlify/functions/client-error.js for what the server keeps.
//
// Each distinct error is sent once per page load and no more than ten in
// all, so a render loop cannot flood the endpoint. Network failures and
// anything while offline are skipped: they cannot be sent and are not bugs.
// Reporting never throws.
import { cleanErrorReport } from './errorReport.js'

declare const __FH_BUILD_SHA__: string

export type ErrorKind = 'route' | 'app' | 'window' | 'promise' | 'query' | 'mutation'

const ENDPOINT = '/api/client-error'
const MAX_REPORTS = 10
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i
const sent = new Set<string>()

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error ?? '')
}

function buildId(): string {
  return typeof __FH_BUILD_SHA__ === 'string' ? __FH_BUILD_SHA__ : 'dev'
}

export function reportClientError(kind: ErrorKind, error: unknown): void {
  try {
    if (typeof location === 'undefined') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const message = messageOf(error)
    if (NETWORK_FAILURE.test(message)) return
    const key = `${kind} ${message}`
    if (sent.has(key) || sent.size >= MAX_REPORTS) return
    sent.add(key)
    const body = JSON.stringify(cleanErrorReport({ route: location.pathname, build: buildId(), message, kind }))
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return
    }
    void fetch(ENDPOINT, { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {})
  } catch {
    // Reporting an error must never cause one.
  }
}

/** Reports errors and rejected promises nothing else caught. */
export function installErrorReporting(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('error', (event: ErrorEvent) => reportClientError('window', event.error ?? event.message))
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => reportClientError('promise', event.reason))
}
