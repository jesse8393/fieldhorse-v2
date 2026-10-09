import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLogoCache, loadImageForPdf, loadLogoForPdf } from './pdfLogo.ts'

// Minimal browser surface the loader touches: fetch, Image and a canvas.
function stubBrowser() {
  const ctx: any = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  const canvas: any = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: vi.fn((type: string) => `data:${type};base64,AAAA`)
  }
  const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['img']) }))
  class FakeImage {
    onload: any = null
    onerror: any = null
    crossOrigin = ''
    naturalWidth = 1800
    naturalHeight = 1200
    set src(_value: string) { setTimeout(() => this.onload?.(), 0) }
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Image', FakeImage)
  return { canvas, ctx, fetchMock }
}

describe('PDF image loader', () => {
  beforeEach(() => clearLogoCache())
  afterEach(() => vi.unstubAllGlobals())

  it('re-encodes project photos as JPEG on a white background', async () => {
    const { canvas, ctx } = stubBrowser()
    const img = await loadImageForPdf('https://cdn.test/photo.png', { maxDimension: 900 })
    expect(img).toEqual({ dataUrl: 'data:image/jpeg;base64,AAAA', format: 'JPEG', width: 900, height: 600 })
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', expect.any(Number))
    expect(ctx.fillStyle).toBe('white')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 900, 600)
  })

  it('keeps the logo as PNG so its transparency survives', async () => {
    const { canvas, ctx } = stubBrowser()
    const logo = await loadLogoForPdf('https://cdn.test/logo.png', { maxDimension: 720 })
    expect(logo?.format).toBe('PNG')
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
    expect(ctx.fillRect).not.toHaveBeenCalled()
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
})
