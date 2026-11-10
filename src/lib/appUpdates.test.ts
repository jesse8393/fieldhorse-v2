import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchAppUpdates } from './appUpdates.ts'

describe('deployed app updates', () => {
  let workers: EventTarget & { controller: object | null; getRegistration: ReturnType<typeof vi.fn> }
  let page: EventTarget & { visibilityState: string }
  let connection: { serviceWorker: typeof workers; onLine: boolean }
  let browser: EventTarget & { setInterval: typeof setInterval; clearInterval: typeof clearInterval }
  let update: ReturnType<typeof vi.fn>
  let stop: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    update = vi.fn().mockResolvedValue(undefined)
    workers = Object.assign(new EventTarget(), { controller: {} as object | null, getRegistration: vi.fn().mockResolvedValue({ update }) })
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    connection = { serviceWorker: workers, onLine: true }
    browser = Object.assign(new EventTarget(), { setInterval, clearInterval })
    vi.stubGlobal('navigator', connection)
    vi.stubGlobal('document', page)
    vi.stubGlobal('window', browser)
  })
  afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

  it('announces replacement of an existing worker without reloading', async () => {
    const ready = vi.fn()
    stop = watchAppUpdates(ready)
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledOnce()
    workers.controller = {}
    workers.dispatchEvent(new Event('controllerchange'))
    expect(ready).toHaveBeenCalledOnce()
    // A duplicate notification for the same controller is not another update.
    workers.dispatchEvent(new Event('controllerchange'))
    expect(ready).toHaveBeenCalledOnce()
  })

  it('does not announce a first install or worker removal as an update', () => {
    workers.controller = null
    const ready = vi.fn()
    stop = watchAppUpdates(ready)
    workers.controller = {}
    workers.dispatchEvent(new Event('controllerchange'))
    workers.controller = null
    workers.dispatchEvent(new Event('controllerchange'))
    expect(ready).not.toHaveBeenCalled()
  })

  it('checks again when a long lived tab becomes visible', async () => {
    stop = watchAppUpdates(vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    page.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(update).toHaveBeenCalledOnce()
    page.visibilityState = 'visible'
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledTimes(2)
    page.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('waits for connectivity and tolerates a failed update check', async () => {
    connection.onLine = false
    update.mockRejectedValue(new Error('Offline'))
    stop = watchAppUpdates(vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(update).not.toHaveBeenCalled()
    connection.onLine = true
    browser.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledOnce()
  })

  it('cleans up checks and controller listeners when the shell unmounts', async () => {
    const ready = vi.fn()
    stop = watchAppUpdates(ready)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    page.dispatchEvent(new Event('visibilitychange'))
    workers.controller = {}
    workers.dispatchEvent(new Event('controllerchange'))
    expect(update).toHaveBeenCalledOnce()
    expect(ready).not.toHaveBeenCalled()
  })

  it('does not start an update after an unmounted registration lookup resolves', async () => {
    let resolve!: (value: object) => void
    workers.getRegistration.mockImplementation(() => new Promise(done => { resolve = done }))
    stop = watchAppUpdates(vi.fn())
    stop()
    resolve({ update })
    await vi.advanceTimersByTimeAsync(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('supports browsers without service workers', () => {
    vi.stubGlobal('navigator', {})
    expect(() => watchAppUpdates(vi.fn())()).not.toThrow()
  })
})
