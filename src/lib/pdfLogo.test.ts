import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLogoCache, loadImageForPdf, loadLogoForPdf } from './pdfLogo.ts'

// Minimal browser surface the loader touches: fetch, Image and a canvas.
function stubBrowser({ decode = true } = {}) {
  const ctx: any = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([20, 20, 20, 255]) })) }
  const canvas: any = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: vi.fn((type: string) => `data:${type};base64,AAAA`)
  }
  const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['img']) }))
  const images: FakeImage[] = []
  class FakeImage {
    onload: any = null
    onerror: any = null
    crossOrigin = ''
    naturalWidth = 1800
    naturalHeight = 1200
    removeAttribute = vi.fn()
    constructor() { images.push(this) }
    set src(_value: string) { if (decode) setTimeout(() => this.onload?.(), 0) }
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Image', FakeImage)
  return { canvas, ctx, fetchMock, images }
}

describe('PDF image loader', () => {
  beforeEach(() => clearLogoCache())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('re-encodes project photos as JPEG on a white background', async () => {
    const { canvas, ctx } = stubBrowser()
    const img = await loadImageForPdf('https://cdn.test/photo.png', { maxDimension: 900 })
    expect(img).toEqual({ dataUrl: 'data:image/jpeg;base64,AAAA', format: 'JPEG', width: 900, height: 600 })
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number))
    expect(ctx.fillStyle).toBe('white')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 900, 600)
  })

  it('keeps opaque logo artwork unchanged in PNG', async () => {
    const { canvas, ctx } = stubBrowser()
    const logo = await loadLogoForPdf('https://cdn.test/logo.png', { maxDimension: 720 })
    expect(logo?.format).toBe('PNG')
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
    expect(ctx.fillRect).not.toHaveBeenCalled()
  })

  it('composites white transparent artwork onto ink for both HTML and PDF', async () => {
    const { ctx } = stubBrowser()
    ctx.getImageData.mockReturnValue({ data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]) })
    await loadLogoForPdf('https://cdn.test/white.png')
    expect(ctx.fillStyle).toBe('#141414')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 720, 480)
    expect(ctx.globalCompositeOperation).toBe('source-over')
  })

  it('does not add a logo backing to transparent PNG project photos', async () => {
    const { ctx } = stubBrowser()
    ctx.getImageData.mockReturnValue({ data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]) })
    await loadImageForPdf('https://cdn.test/photo.png', { format: 'png' })
    expect(ctx.fillRect).not.toHaveBeenCalled()
    expect(ctx.getImageData).not.toHaveBeenCalled()
  })

  it('caches per format, so a logo and a photo of one URL never share an entry', async () => {
    const { fetchMock } = stubBrowser()
    const url = 'https://cdn.test/same.png'
    const photo = await loadImageForPdf(url)
    const logo = await loadLogoForPdf(url)
    await loadImageForPdf(url)
    expect(photo?.format).toBe('JPEG')
    expect(logo?.format).toBe('PNG')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('settles and caches null when fetching never returns, even if abort is ignored', async () => {
    vi.useFakeTimers()
    const { fetchMock } = stubBrowser()
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const url = 'https://cdn.test/hung-fetch.png'
    const loading = loadLogoForPdf(url, { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(loading).resolves.toBeNull()
    expect(loadLogoForPdf(url)).toBe(loading)
    await expect(loadLogoForPdf(url)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the deadline active while reading the response body and ignores a late body', async () => {
    vi.useFakeTimers()
    const { fetchMock, images } = stubBrowser()
    let finishBody!: (blob: Blob) => void
    fetchMock.mockResolvedValue({ ok: true, blob: () => new Promise((resolve) => { finishBody = resolve }) })
    const objectUrl = vi.spyOn(URL, 'createObjectURL')
    const loading = loadLogoForPdf('https://cdn.test/hung-body.png', { timeoutMs: 1000 })
    let settled = false
    void loading.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(loading).resolves.toBeNull()
    finishBody(new Blob(['late']))
    await vi.advanceTimersByTimeAsync(0)
    expect(objectUrl).not.toHaveBeenCalled()
    expect(images).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses only the remaining budget for decoding and cleans up a stalled image', async () => {
    vi.useFakeTimers()
    const { fetchMock, images, canvas } = stubBrowser({ decode: false })
    fetchMock.mockResolvedValue({ ok: true, blob: () => new Promise((resolve) => setTimeout(() => resolve(new Blob(['img'])), 600)) })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const loading = loadLogoForPdf('https://cdn.test/hung-decode.png', { timeoutMs: 1000 })
    let settled = false
    void loading.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(600)
    expect(images).toHaveLength(1)
    const lateLoad = images[0].onload
    await vi.advanceTimersByTimeAsync(399)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(loading).resolves.toBeNull()
    expect(images[0].onload).toBeNull()
    expect(images[0].onerror).toBeNull()
    expect(images[0].removeAttribute).toHaveBeenCalledWith('src')
    expect(revoke).toHaveBeenCalledTimes(1)
    lateLoad()
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
