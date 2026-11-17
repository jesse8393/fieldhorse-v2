// Failures a phone really meets, answered the way PostgREST, a gateway or a
// dropped connection answers them, and the words that must never reach a
// screen (raw-errors). A failed save or read says what did not happen and
// what to do next in plain words, never the server's or the browser's own.
import type { BrowserContext, Locator } from '@playwright/test'
import { expect } from '@playwright/test'

type Answer = { status: number; body: string; contentType: string }
const json = (status: number, body: object): Answer => ({ status, body: JSON.stringify(body), contentType: 'application/json' })

export const FAIL = {
  rls: (table: string) => json(403, { code: '42501', details: null, hint: null, message: `new row violates row-level security policy for table "${table}"` }),
  denied: (table: string) => json(403, { code: '42501', details: null, hint: null, message: `permission denied for table ${table}` }),
  jwt: () => json(401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' }),
  check: (table: string, constraint: string) => json(400, { code: '23514', details: 'Failing row contains (...).', hint: null, message: `new row for relation "${table}" violates check constraint "${constraint}"` }),
  // What Cloudflare sends when the database's gateway is down.
  gateway: (): Answer => ({ status: 502, contentType: 'text/html', body: '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>' })
}

export const RAW_ERROR_TEXT = /row-level security|violates|duplicate key|permission denied|PGRST|JWT|canceling statement|TypeError|Failed to fetch|<html|Bad Gateway|cloudflare|fh_[a-z_]+|HTTP \d{3}|send_failed|invalid_token|invalid_rate|sender_not_configured|Bearer|Netlify|Resend keys|DocuSign keys|Database error|Unknown/i

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Answers one table's requests of one method with `answer`, or drops them. */
export async function failRest(context: BrowserContext, table: string, method: Method, answer: Answer | 'abort') {
  await context.route((url) => url.pathname === `/rest/v1/${table}`, (route) => {
    if (route.request().method() !== method) return route.fallback()
    if (answer === 'abort') return route.abort('failed')
    return route.fulfill({ status: answer.status, contentType: answer.contentType, body: answer.body })
  })
}

/** The line or toast says `plain` and none of the raw words. */
export async function expectPlain(where: Locator, plain: string | RegExp) {
  await expect(where.first()).toContainText(plain, { timeout: 20_000 })
  for (const text of await where.allInnerTexts()) expect(text).not.toMatch(RAW_ERROR_TEXT)
}
