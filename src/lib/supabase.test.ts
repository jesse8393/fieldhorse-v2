import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_ORG_HEADER, READ_TIMEOUT_MS, detectSessionInUrl, fetchWithActiveOrg, setActiveOrgId, supabase } from './supabase.ts'
import { isNetworkError } from './outbox.ts'

function stubFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init })
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return calls
}

describe('active workspace header', () => {
  afterEach(() => {
    setActiveOrgId(null)
    vi.unstubAllGlobals()
  })

  it('names the active workspace on REST requests and keeps the other headers', async () => {
    const calls = stubFetch()
    setActiveOrgId('org-2')
    await fetchWithActiveOrg('https://p.supabase.co/rest/v1/fh_contacts?select=id', {
      method: 'POST',
      headers: new Headers({ apikey: 'anon', Authorization: 'Bearer jwt' })
    })
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get(ACTIVE_ORG_HEADER)).toBe('org-2')
    expect(headers.get('apikey')).toBe('anon')
    expect(headers.get('authorization')).toBe('Bearer jwt')
    expect(calls[0].init?.method).toBe('POST')
  })

  it('leaves auth, storage and edge function requests alone', async () => {
    const calls = stubFetch()
    setActiveOrgId('org-2')
    for (const url of [
      'https://p.supabase.co/auth/v1/token?grant_type=refresh_token',
      'https://p.supabase.co/storage/v1/object/job-photos/a.jpg',
      'https://p.supabase.co/functions/v1/notify'
    ]) {
      await fetchWithActiveOrg(url, { headers: { apikey: 'anon' } })
    }
    for (const call of calls) expect(new Headers(call.init?.headers).has(ACTIVE_ORG_HEADER)).toBe(false)
  })

  it('sends no header once the workspace is cleared (sign out)', async () => {
    const calls = stubFetch()
    setActiveOrgId('org-2')
    setActiveOrgId(null)
    await fetchWithActiveOrg('https://p.supabase.co/rest/v1/fh_notes', { headers: { apikey: 'anon' } })
    expect(new Headers(calls[0].init?.headers).has(ACTIVE_ORG_HEADER)).toBe(false)
  })

  it('is wired into the shared supabase client', async () => {
    const calls = stubFetch()
    setActiveOrgId('org-7')
    await supabase.from('fh_contacts').select('id')
    const rest = calls.find((c) => c.url.includes('/rest/v1/fh_contacts'))
    expect(rest).toBeTruthy()
    expect(new Headers(rest?.init?.headers).get(ACTIVE_ORG_HEADER)).toBe('org-7')
  })
})

describe('auth tokens in the URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubHistory() {
    const replaceState = vi.fn()
    vi.stubGlobal('window', { history: { state: { key: 'k1', idx: 3 }, replaceState } })
    return replaceState
  }

  it('drops the token fragment from the current history entry, keeping path, query and router state', () => {
    const replaceState = stubHistory()
    const current = new URL('https://app.example/reset-password?from=email#access_token=a&refresh_token=r&type=recovery')
    expect(detectSessionInUrl(current, { access_token: 'a', refresh_token: 'r', type: 'recovery' })).toBe(true)
    expect(replaceState).toHaveBeenCalledWith({ key: 'k1', idx: 3 }, '', '/reset-password?from=email')
  })

  it('leaves error links and ordinary pages alone', () => {
    const replaceState = stubHistory()
    expect(detectSessionInUrl(new URL('https://app.example/login#error_description=Link+expired'), { error_description: 'Link expired' })).toBe(true)
    expect(detectSessionInUrl(new URL('https://app.example/settings#templates'), {})).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('reads that never answer', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // A fetch that never answers, and rejects only when its signal aborts.
  function stubHungFetch() {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    }))
    return calls
  }

  it('gives up on a REST read with no answer after the read timeout', async () => {
    vi.useFakeTimers()
    stubHungFetch()
    let outcome: unknown = 'pending'
    void fetchWithActiveOrg('https://p.supabase.co/rest/v1/fh_leads?select=*', { method: 'GET' }).then(
      () => { outcome = 'answered' },
      (error) => { outcome = error }
    )
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1)
    expect(outcome).toBe('pending')
    await vi.advanceTimersByTimeAsync(2)
    expect((outcome as Error).name).toBe('AbortError')
    // Reported like any other lost connection.
    expect(isNetworkError(outcome)).toBe(true)
  })

  it('times out a hung read made through the shared client, which then reports an error', async () => {
    vi.useFakeTimers()
    stubHungFetch()
    // The builder sends on then(), so start it before the clock moves.
    const read = supabase.from('fh_leads').select('id').then((result) => result)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1)
    const { error, status } = await read
    expect(status).toBe(0)
    expect(error).toBeTruthy()
  })

  it('never cuts off a write, an upload, an RPC or a sign in, however long they take', async () => {
    vi.useFakeTimers()
    const calls = stubHungFetch()
    const settled: string[] = []
    const requests: Array<[string, RequestInit]> = [
      ['https://p.supabase.co/rest/v1/fh_notes', { method: 'POST' }],
      ['https://p.supabase.co/rest/v1/fh_notes?id=eq.1', { method: 'PATCH' }],
      ['https://p.supabase.co/rest/v1/rpc/fh_merge_clients', { method: 'POST' }],
      ['https://p.supabase.co/storage/v1/object/job-photos/a.jpg', { method: 'POST' }],
      ['https://p.supabase.co/storage/v1/object/job-photos/a.jpg', { method: 'GET' }],
      ['https://p.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' }],
    ]
    for (const [url, init] of requests) {
      void fetchWithActiveOrg(url, init).then(() => settled.push(url), () => settled.push(url))
    }
    await vi.advanceTimersByTimeAsync(10 * READ_TIMEOUT_MS)
    expect(settled).toEqual([])
    expect(calls).toHaveLength(requests.length)
  })

  it('still lets the caller cancel a read', async () => {
    stubHungFetch()
    const controller = new AbortController()
    const read = fetchWithActiveOrg('https://p.supabase.co/rest/v1/fh_leads', { method: 'GET', signal: controller.signal })
    controller.abort()
    await expect(read).rejects.toBeTruthy()
  })
})
