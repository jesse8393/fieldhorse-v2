// PDF logo embed helper — Phase 4D-2B.
//
// Loads a contractor's logo from a Supabase signed URL and converts it
// into a jsPDF-ready PNG data URL. Used by generateQuote() (Phase 4D-2C)
// and generateInvoice() (Phase 4D-2D) to brand customer-facing PDFs
// with the contractor's mark.
//
// Strategy — single path for all formats:
//   1. fetch() the signed URL with an AbortController timeout
//   2. blob → object URL (same-origin)
//   3. <img> with crossOrigin="anonymous"
//   4. drawImage() onto an offscreen canvas, scaled to maxDimension
//   5. canvas.toDataURL('image/png') — taint-safe because data was
//      ingested via fetch() (already in our origin's memory)
//
// Supports PNG and SVG (the canonical upload formats), plus JPEG and
// WebP defensively. Returns null on any failure so the caller can
// fall back to a typographic wordmark — logo never blocks a PDF.
//
// Cache: module-level Map keyed by `${maxDimension}:${url}`. Stores
// promises (so concurrent calls share one fetch) and the resolved value
// is { dataUrl, format, width, height } | null. Negative results are
// cached for the session — a transient failure won't retry on every
// Preview / Download / Send. Operators can refresh to retry.

const cache = new Map()

/**
 * Load a logo and return a jsPDF-compatible image descriptor.
 *
 * @param {string} logoUrl                       signed URL from profiles.logo_url
 * @param {object} [opts]
 * @param {number} [opts.maxDimension=720]       max width or height (px) of the
 *                                               rasterized output. Keeps PDF
 *                                               size sane for large uploads.
 * @param {number} [opts.timeoutMs=8000]         abort fetch after this many ms.
 * @returns {Promise<{ dataUrl: string, format: 'PNG', width: number, height: number } | null>}
 */
export function loadLogoForPdf(logoUrl, { maxDimension = 720, timeoutMs = 8000 } = {}) {
  if (!logoUrl || typeof logoUrl !== 'string') return Promise.resolve(null)

  const key = `${maxDimension}:${logoUrl}`
  if (cache.has(key)) return cache.get(key)

  const p = doLoad(logoUrl, maxDimension, timeoutMs).catch(() => null)
  cache.set(key, p)
  return p
}

async function doLoad(url, maxDimension, timeoutMs) {
  const blob = await fetchWithTimeout(url, timeoutMs)
  if (!blob) return null

  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImage(objectUrl)
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
    // High-quality scaling — better-than-default smoothing for the
    // common "square brand mark scaled down to 80mm wide" case.
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    try {
      ctx.drawImage(img, 0, 0, targetW, targetH)
    } catch {
      return null
    }

    let dataUrl
    try {
      dataUrl = canvas.toDataURL('image/png')
    } catch (e) {
      // Tainted canvas (extremely rare for SVGs that reference external
      // resources). One warning here is acceptable per spec.
      console.warn('[pdfLogo] canvas.toDataURL failed', e)
      return null
    }
    if (!dataUrl || dataUrl === 'data:,') return null

    return { dataUrl, format: 'PNG', width: targetW, height: targetH }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve) => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = setTimeout(() => {
      try { ctrl?.abort() } catch {}
      resolve(null)
    }, timeoutMs)

    fetch(url, {
      signal: ctrl?.signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'force-cache'
    })
      .then(async (r) => {
        clearTimeout(timer)
        if (!r.ok) { resolve(null); return }
        try {
          const b = await r.blob()
          resolve(b)
        } catch {
          resolve(null)
        }
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(null)
      })
  })
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Test helper / hot-reload safety. Clears the in-memory cache so a
 * fresh upload is fetched again. Not used in production; exposed only
 * for unit tests or future re-fetch UX. Safe to leave shipped — it
 * does nothing unless explicitly called.
 */
export function clearLogoCache() {
  cache.clear()
}

/**
 * Same loader, semantic alias for project photos. The implementation is
 * already content-agnostic — it just needs a URL that returns image
 * bytes. Exporting a separate name so call sites read clearly:
 *   loadLogoForPdf(...)  for the contractor's brand mark
 *   loadImageForPdf(...) for project photos / hero images
 *
 * Same cache, same null-on-failure contract.
 */
export const loadImageForPdf = loadLogoForPdf
