// plainError (serviceErrors.ts): every failure a screen shows is a plain
// sentence. These are the shapes a phone really meets: the browser's own
// fetch failure, PostgREST error objects, a gateway's HTML page, Supabase
// auth and storage errors, and the bodies our Netlify functions return.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorKind, plainError } from './serviceErrors.ts'

const FALLBACK = 'Could not save the job. Try again.'

// Words that must never reach a screen.
const RAW = /row-level security|violates|duplicate key|permission denied|PGRST|JWT|canceling statement|TypeError|Failed to fetch|<html|Bad Gateway|cloudflare|fh_[a-z_]+|HTTP \d{3}|[a-z]+_[a-z_]+|Bearer|Netlify|Database error|Unknown/i

const CLOUDFLARE_502 = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<html class="no-js" lang="en-US">
<head><title>qa-mock.supabase.co | 502: Bad gateway</title>
<meta charset="UTF-8" /></head>
<body><div id="cf-wrapper"><h1><span class="inline-block">Bad gateway</span>
<span class="code-label">Error code 502</span></h1>
<p>Visit <a href="https://www.cloudflare.com/5xx-error-landing">cloudflare.com</a> for more information.</p>
<span class="cf-footer-item">Cloudflare Ray ID: <strong>8c1f2e3d4a5b6c7d</strong></span>
</div></body></html>`

// What postgrest-js 2.103 resolves `error` to for each failure.
const PG = {
  offline: { message: 'TypeError: Failed to fetch', details: 'TypeError: Failed to fetch', hint: '', code: '' },
  rls: { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "fh_contacts"' },
  denied: { code: '42501', details: null, hint: null, message: 'permission denied for table fh_contacts' },
  jwt: { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' },
  dup: { code: '23505', details: 'Key (id)=(x) already exists.', hint: null, message: 'duplicate key value violates unique constraint "fh_contacts_pkey"' },
  timeout: { code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' },
  gateway: { message: CLOUDFLARE_502 },
  check: { code: '23514', details: 'Failing row contains (...).', hint: null, message: 'new row for relation "fh_payments" violates check constraint "fh_payments_kind_check"' }
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('errorKind', () => {
  it('reads a lost connection from the browser, postgrest, auth and Safari', () => {
    expect(errorKind(new TypeError('Failed to fetch'))).toBe('offline')
    expect(errorKind(new TypeError('Load failed'))).toBe('offline')
    expect(errorKind(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('offline')
    expect(errorKind(PG.offline)).toBe('offline')
    expect(errorKind(Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }))).toBe('offline')
  })

  it('calls anything offline when the phone says it has no network', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(errorKind(PG.rls)).toBe('offline')
  })

  it('reads a lapsed sign in', () => {
    expect(errorKind(PG.jwt)).toBe('session')
    expect(errorKind({ code: 'PGRST301', message: 'JWSError JWSInvalidSignature' })).toBe('session')
    expect(errorKind(Object.assign(new Error('invalid_token'), { status: 401 }))).toBe('session')
    expect(errorKind({ error: 'invalid_token' })).toBe('session')
    expect(errorKind(Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' }))).toBe('session')
    expect(errorKind(Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 }))).toBe('session')
  })

  it('reads a refusal from row level security, a grant or a 403', () => {
    expect(errorKind(PG.rls)).toBe('permission')
    expect(errorKind(PG.denied)).toBe('permission')
    expect(errorKind(Object.assign(new Error('new row violates row-level security policy'), { name: 'StorageApiError', status: 403, statusCode: '403' }))).toBe('permission')
    expect(errorKind({ error: 'insufficient_role' })).toBe('permission')
  })

  it('reads a duplicate or a conflict', () => {
    expect(errorKind(PG.dup)).toBe('conflict')
    expect(errorKind({ status: 409, message: 'conflict' })).toBe('conflict')
  })

  it('reads a server or gateway failure, HTML pages included', () => {
    expect(errorKind(PG.gateway)).toBe('server')
    expect(errorKind(PG.timeout)).toBe('server')
    expect(errorKind(new Error('Internal Server Error'))).toBe('server')
    expect(errorKind(Object.assign(new Error('Database error querying schema'), { name: 'AuthApiError', status: 500, code: 'unexpected_failure' }))).toBe('server')
    expect(errorKind(new Error('http_503'))).toBe('server')
  })

  it('leaves anything else unknown', () => {
    expect(errorKind(PG.check)).toBe('unknown')
    expect(errorKind(undefined)).toBe('unknown')
    expect(errorKind(new Error('Enter a client.'))).toBe('unknown')
  })
})

describe('plainError', () => {
  it('never lets raw text through, for every shape', () => {
    const shapes: unknown[] = [
      ...Object.values(PG),
      new TypeError('Failed to fetch'),
      new Error('TypeError: Failed to fetch'),
      new Error('new row violates row-level security policy for table "fh_quotes"'),
      'JWT expired',
      { error: 'send_failed', provider_status: 403, detail: 'The gmail.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' },
      { error: 'missing_token', detail: 'Authorization: Bearer <access_token> is required.' },
      { error: 'server_misconfigured', detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Netlify env.' },
      { error: 'some_new_code' },
      new Error('invalid_rate'),
      new Error('Unknown provider error'),
      { message: 'Object not found', statusCode: '404', error: 'not_found' },
      new RangeError('Invalid time value'),
      Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400, code: 'invalid_credentials' }),
      null,
      42
    ]
    for (const shape of shapes) {
      const said = plainError(shape, FALLBACK)
      expect(said, JSON.stringify(shape)).not.toMatch(RAW)
      expect(said, JSON.stringify(shape)).toMatch(/^[A-Z].*[.]$/)
    }
  })

  it('says there is no signal and keeps the work when the caller says so', () => {
    expect(plainError(new TypeError('Failed to fetch'), FALLBACK)).toBe('No signal right now. Try again when the signal is back.')
    expect(plainError(PG.offline, FALLBACK, { kept: true })).toBe('No signal right now. Your work is still here, so try again when the signal is back.')
  })

  it('says each kind in plain words', () => {
    expect(plainError(PG.jwt, FALLBACK)).toBe('Your sign in ran out. Sign in again, then try again.')
    expect(plainError(PG.rls, FALLBACK)).toBe('Your role does not allow this. Ask an owner or admin.')
    expect(plainError(PG.dup, FALLBACK)).toBe('This was already saved. Refresh to see the latest.')
    expect(plainError(PG.gateway, FALLBACK)).toBe('Something went wrong on our side. Try again in a minute.')
    expect(plainError({ status: 429 }, FALLBACK)).toBe('Too many tries at once. Wait a minute, then try again.')
  })

  it("gives the caller's sentence for anything else", () => {
    expect(plainError(PG.check, FALLBACK)).toBe(FALLBACK)
    expect(plainError(new RangeError('Invalid time value'), FALLBACK)).toBe(FALLBACK)
    expect(plainError({ error: 'some_new_code' }, FALLBACK)).toBe(FALLBACK)
  })

  it('passes through a plain sentence our own code threw', () => {
    expect(plainError(new Error('Enter a client.'), FALLBACK)).toBe('Enter a client.')
    expect(plainError(new Error('Only $40.00 remains unreserved on this contract.'), FALLBACK)).toBe('Only $40.00 remains unreserved on this contract.')
  })

  it("maps our functions' codes, preferring the plain sentence the function sent", () => {
    expect(plainError({ error: 'invalid_rate', message: 'Rate must be between 0 and 10000.' }, FALLBACK)).toBe('Rate must be between 0 and 10000.')
    // orgApi keeps the code on message and the sentence on detail.
    expect(plainError(Object.assign(new Error('invalid_rate'), { status: 400, detail: 'Rate must be between 0 and 10000.' }), FALLBACK)).toBe('Rate must be between 0 and 10000.')
    expect(plainError(Object.assign(new Error('rate_update_failed'), { status: 500, detail: null }), FALLBACK)).toBe('Something went wrong on our side. Try again in a minute.')
    expect(plainError({ error: 'contract_billing_exceeded', message: 'Invoices and drafts exceed approved contract value. Reduce or void unused drafts before sending.' }, FALLBACK)).toBe('Invoices and drafts exceed approved contract value. Reduce or void unused drafts before sending.')
    expect(plainError({ error: 'last_owner' }, FALLBACK)).toBe('A company needs at least one owner. Make someone else owner first.')
  })

  it("never shows a provider's words or developer setup text, even when they read like a sentence", () => {
    expect(plainError({ error: 'send_failed', provider_status: 422, detail: 'You can only send testing emails to your own email address.' }, FALLBACK))
      .toBe('The email did not go out. Try again, or download the PDF and send it yourself.')
    expect(plainError({ error: 'server_misconfigured', detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Netlify env.' }, FALLBACK))
      .toBe('This is not available right now. Try again later.')
    expect(plainError({ error: 'sender_not_configured', message: 'Email sender is not configured yet.' }, FALLBACK))
      .toBe('Email sending is not set up for this company yet.')
    expect(plainError({ error: 'missing_token', detail: 'Authorization: Bearer <access_token> is required.' }, FALLBACK))
      .toBe('Your sign in ran out. Sign in again, then try again.')
  })

  it('puts sign in failures in our own words', () => {
    expect(plainError(Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400, code: 'invalid_credentials' }), FALLBACK)).toBe('Wrong email or password.')
    expect(plainError(Object.assign(new Error('Email not confirmed'), { name: 'AuthApiError', status: 400, code: 'email_not_confirmed' }), FALLBACK)).toBe('Confirm your email first. The link is in your inbox.')
  })

  it('still logs the raw value for us', () => {
    const refusal = { ...PG.rls }
    plainError(refusal, FALLBACK)
    expect(console.warn).toHaveBeenCalledWith('[fieldhorse]', FALLBACK, refusal)
  })
})
