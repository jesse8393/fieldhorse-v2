// PDF image embed helper, Phase 4D-2B.
//
// Loads a contractor's logo or a project photo from a Supabase signed URL
// and converts it into a jsPDF-ready data URL. Used by generateQuote() and
// generateInvoice() to brand customer facing PDFs with the contractor's
// mark and to embed jobsite photos.
//
// Strategy, single path for all formats:
//   1. fetch() the signed URL with one fetch/body/decode deadline
//   2. blob → object URL (same-origin)
//   3. <img> with crossOrigin="anonymous"
//   4. drawImage() onto an offscreen canvas, scaled to maxDimension
//   5. canvas.toDataURL(), taint-safe because data was ingested via
//      fetch() (already in our origin's memory)
//
// Output format: logos stay PNG. Transparent marks receive the document
// ink or paper backing that best contrasts with their visible pixels;
// opaque artwork is unchanged. Photos are re-encoded as JPEG: a 900px
// jobsite photo is roughly 1 MB as PNG against about 120 KB as JPEG, and
// jsPDF also has to parse and deflate PNG data on the main thread, so PNG
// photos made multi MB proposals that were slow to build on a phone and
// heavy to email.
//
// Supports PNG and SVG (the canonical logo upload formats), plus JPEG and
// WebP. Returns null on any failure so the caller can fall back to a
// typographic wordmark, an image never blocks a PDF.
//
// Cache: module-level Map keyed by format, size, backdrop treatment and URL.
// Stores promises (so concurrent calls share one fetch) and the resolved
// value is { dataUrl, format, width, height } | null. Negative results are
// cached for the session, a transient failure won't retry on every
// Preview / Download / Send. Operators can refresh to retry.

import { logoBackdrop } from './logoContrast.ts'

export type ImageFormat = 'png' | 'jpeg'
export type LogoDescriptor = { dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number }
type LoadOptions = { maxDimension?: number; timeoutMs?: number; format?: ImageFormat; contrastBackdrop?: boolean }

const JPEG_QUALITY = 0.82

const cache = new Map<string, Promise<LogoDescriptor | null>>()

/**
 * Load an image and return a jsPDF-compatible image descriptor. PNG by
 * default, with a contrasting backing for transparent logos.
 */
export function loadLogoForPdf(logoUrl: string | null | undefined, { maxDimension = 720, timeoutMs = 8000, format = 'png', contrastBackdrop = true }: LoadOptions = {}): Promise<LogoDescriptor | null> {
  if (!logoUrl || typeof logoUrl !== 'string') return Promise.resolve(null)

  const key = `${format}:${maxDimension}:${contrastBackdrop}:${logoUrl}`
  const cached = cache.get(key)
  if (cached) return cached

  const p = doLoad(logoUrl, maxDimension, timeoutMs, format, contrastBackdrop).catch(() => null)
  cache.set(key, p)
  return p
}

async function doLoad(url: string, maxDimension: number, timeoutMs: number, format: ImageFormat, contrastBackdrop: boolean): Promise<LogoDescriptor | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let objectUrl: string | null = null
  try {
    const blob = await fetchBlob(url, controller.signal)
    if (!blob || controller.signal.aborted) return null
    objectUrl = URL.createObjectURL(blob)
    const img = await loadImage(objectUrl, controller.signal)
    if (!img) return null

    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    if (!srcW || !srcH) return null

    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH))
    const targetW = Math.max(1, Math.round(srcW * scale))
    const targetH = Math.max(1, Math.round(srcH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // JPEG has no alpha channel: paint white first so a transparent
    // region comes out white instead of black.
    if (format === 'jpeg') {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, targetW, targetH)
    }
    // High-quality scaling, better-than-default smoothing for the
    // common "square brand mark scaled down to 80mm wide" case.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    try {
      ctx.drawImage(img, 0, 0, targetW, targetH)
    } catch {
      return null
    }

    if (format === 'png' && contrastBackdrop) {
      try {
        const background = logoBackdrop(ctx.getImageData(0, 0, targetW, targetH).data)
        if (background) {
          ctx.globalCompositeOperation = 'destination-over'
          ctx.fillStyle = background
          ctx.fillRect(0, 0, targetW, targetH)
          ctx.globalCompositeOperation = 'source-over'
        }
      } catch { /* Keep the original appearance if pixels cannot be read. */ }
    }

    let dataUrl: string
    try {
      dataUrl = format === 'jpeg'
        ? canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        : canvas.toDataURL('image/png')
    } catch (e) {
      // Tainted canvas (extremely rare for SVGs that reference external
      // resources). One warning here is acceptable per spec.
      console.warn('[pdfLogo] canvas.toDataURL failed', e)
      return null
    }
    if (!dataUrl || dataUrl === 'data:,') return null

    return { dataUrl, format: format === 'jpeg' ? 'JPEG' : 'PNG', width: targetW, height: targetH }
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

function fetchBlob(url: string, signal: AbortSignal): Promise<Blob | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (blob: Blob | null) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(blob)
    }
    const onAbort = () => finish(null)
    signal.addEventListener('abort', onAbort, { once: true })

    fetch(url, {
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache'
    })
      .then(async (r) => r.ok ? await r.blob() : null)
      .then(finish, () => finish(null))
  })
}

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const finish = (loaded: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      img.onload = null
      img.onerror = null
      if (!loaded) img.removeAttribute('src')
      resolve(loaded)
    }
    const onAbort = () => finish(null)
    signal.addEventListener('abort', onAbort, { once: true })
    img.crossOrigin = 'anonymous'
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    img.src = src
  })
}

/**
 * Test helper / hot-reload safety. Clears the in-memory cache so a
 * fresh upload is fetched again. Not used in production; exposed only
 * for unit tests or future re-fetch UX. Safe to leave shipped, it
 * does nothing unless explicitly called.
 */
export function clearLogoCache() {
  cache.clear()
}

/**
 * Project photos and hero images. Same loader, cache and null-on-failure
 * contract as loadLogoForPdf, but re-encoded as JPEG (see the header).
 *   loadLogoForPdf(...)  for the contractor's brand mark
 *   loadImageForPdf(...) for project photos / hero images
 */
export function loadImageForPdf(url: string | null | undefined, options: LoadOptions = {}): Promise<LogoDescriptor | null> {
  return loadLogoForPdf(url, { ...options, format: options.format || 'jpeg', contrastBackdrop: false })
}
