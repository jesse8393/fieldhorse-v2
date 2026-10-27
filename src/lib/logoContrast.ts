import { DOC_COLORS, hexToRgb } from '../components/documents/tokens.ts'

function luminance(r: number, g: number, b: number) {
  const linear = [r, g, b].map((channel) => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

const surfaces = [DOC_COLORS.ink, DOC_COLORS.paper]
const surfaceLight = surfaces.map((surface) => luminance(...hexToRgb(surface)))

/** Choose a contrasting document surface without changing opaque artwork. */
export function logoBackdrop(pixels: Uint8ClampedArray): string | null {
  if (!pixels.length) return null
  let transparent = 0
  let visibleWeight = 0
  const scores = [0, 0]
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    if (alpha < 0.98) transparent++
    if (alpha < 0.1) continue
    visibleWeight += alpha
    const light = luminance(pixels[i], pixels[i + 1], pixels[i + 2])
    for (let s = 0; s < scores.length; s++) {
      const contrast = (Math.max(light, surfaceLight[s]) + 0.05) / (Math.min(light, surfaceLight[s]) + 0.05)
      scores[s] += Math.log(contrast) * alpha
    }
  }
  // Anti-aliased edges alone do not justify adding a plate to opaque art.
  if (transparent / (pixels.length / 4) < 0.02 || !visibleWeight) return null
  return surfaces[scores[0] > scores[1] ? 0 : 1]
}
