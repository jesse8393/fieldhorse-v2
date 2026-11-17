import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The browser side of /api/client-error. A crash, an uncaught rejection or
// a failed query must reach the server, once, with no record data, and
// reporting must never itself throw.

let beacons: { url: string; body: any }[]

async function load() {
  vi.resetModules()
  return import('./reportClientError.ts')
}

beforeEach(() => {
  beacons = []
  vi.stubGlobal('location', { pathname: '/jobs/2f1c9a7e-1b2c-4d5e-8f90-123456789abc', search: '?tab=money' })
  vi.stubGlobal('navigator', {
    onLine: true,
    sendBeacon: (url: string, blob: Blob) => {
      beacons.push({ url, body: blob })
      return true
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function sent() {
  return Promise.all(beacons.map(async (b) => ({ url: b.url, body: JSON.parse(await (b.body as Blob).text()) })))
}

describe('reportClientError', () => {
  it('sends route, build, message and kind to /api/client-error, with no ids', async () => {
    const { reportClientError } = await load()
    reportClientError('route', new TypeError("Cannot read properties of undefined (reading 'slice')"))
    expect(await sent()).toEqual([{
      url: '/api/client-error',
      body: { route: '/jobs/:id', build: expect.any(String), message: "TypeError: Cannot read properties of undefined (reading 'slice')", kind: 'route' }
    }])
  })

  it('sends the same error once per page load, and at most ten in all', async () => {
    const { reportClientError } = await load()
    reportClientError('window', new Error('same'))
    reportClientError('window', new Error('same'))
    for (let i = 0; i < 20; i++) reportClientError('promise', new Error(`other ${String.fromCharCode(97 + i)}`))
    expect(beacons).toHaveLength(10)
  })

  it('skips network failures and anything while offline, since they cannot be sent and are not bugs', async () => {
    const { reportClientError } = await load()
    reportClientError('query', new TypeError('Failed to fetch'))
    reportClientError('query', { message: 'TypeError: NetworkError when attempting to fetch resource.' })
    ;(navigator as any).onLine = false
    reportClientError('query', new Error('real bug'))
    expect(beacons).toHaveLength(0)
  })

  it('falls back to fetch with keepalive and never throws', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', fetchSpy)
    const { reportClientError } = await load()
    expect(() => reportClientError('app', 'plain string error')).not.toThrow()
    expect(fetchSpy).toHaveBeenCalledWith('/api/client-error', expect.objectContaining({ method: 'POST', keepalive: true }))
  })

  it('listens for uncaught errors and rejections on the window', async () => {
    const listeners: Record<string, (event: any) => void> = {}
    const target = { addEventListener: (type: string, fn: (event: any) => void) => { listeners[type] = fn } }
    const { installErrorReporting } = await load()
    installErrorReporting(target as any)
    listeners.error({ error: new Error('thrown in a handler'), message: 'Uncaught Error: thrown in a handler' })
    listeners.unhandledrejection({ reason: new Error('rejected') })
    expect((await sent()).map((s) => [s.body.kind, s.body.message])).toEqual([
      ['window', 'Error: thrown in a handler'],
      ['promise', 'Error: rejected']
    ])
  })
})

describe('queryClient', () => {
  it('reports a failed query and a failed mutation', async () => {
    vi.resetModules()
    const { queryClient } = await import('./queryClient.ts')
    await queryClient.fetchQuery({ queryKey: ['boom'], queryFn: async () => { throw new Error('query broke') }, retry: false }).catch(() => {})
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: async () => { throw new Error('save broke') } })
    await mutation.execute(undefined).catch(() => {})
    expect((await sent()).map((s) => [s.body.kind, s.body.message])).toEqual([
      ['query', 'Error: query broke'],
      ['mutation', 'Error: save broke']
    ])
  })
})
