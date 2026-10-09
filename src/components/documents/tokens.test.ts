import { describe, expect, it } from 'vitest'
import { DOC_COLORS, THEME_PALETTES, hexToRgb, mixHex } from './tokens.ts'
import { groupPhotosByTag, photoGroupTag, UNTAGGED_PHOTO_GROUP } from './photoGroups.ts'

// WCAG 2 contrast ratio between two '#RRGGBB' colors.
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((c) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('document color tokens', () => {
  it('mixes like CSS color-mix in srgb', () => {
    // 50% of ink (20, 20, 20) over paper (242, 237, 228), channel by channel.
    expect(hexToRgb(mixHex('#141414', '#F2EDE4', 0.5))).toEqual([131, 129, 124])
    expect(mixHex('#141414', '#F2EDE4', 0).toUpperCase()).toBe('#F2EDE4')
    expect(hexToRgb('#C9963A')).toEqual([201, 150, 58])
  })

  it('keeps dividers and soft panels visible on the paper', () => {
    for (const key of ['rule', 'ruleStrong', 'paperSoft'] as const) {
      expect(DOC_COLORS[key].toLowerCase(), key).not.toBe(DOC_COLORS.paper.toLowerCase())
      expect(DOC_COLORS[key]).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(contrast(DOC_COLORS.ruleStrong, DOC_COLORS.paper)).toBeGreaterThan(contrast(DOC_COLORS.rule, DOC_COLORS.paper))
  })

  it('keeps captions and fine print readable (WCAG AA)', () => {
    expect(contrast(DOC_COLORS.inkFaint, DOC_COLORS.paper)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(DOC_COLORS.inkMuted, DOC_COLORS.paper)).toBeGreaterThanOrEqual(4.5)
  })

  it('gives every estimate theme a distinct accent and visible row rules', () => {
    const accents = Object.values(THEME_PALETTES).map((p) => p.accent)
    expect(new Set(accents).size).toBe(accents.length)
    expect(THEME_PALETTES.mint.accent).toBe(DOC_COLORS.signalGreen)
    for (const [name, p] of Object.entries(THEME_PALETTES)) {
      expect(p.rule.toLowerCase(), name).not.toBe((p.paper || DOC_COLORS.paper).toLowerCase())
    }
  })
})

describe('project photo groups', () => {
  it('reads a tag that is only the caption as no tag', () => {
    const caption = 'Demo complete; subfloor sound, no rot under tub'
    expect(photoGroupTag({ section_tag: caption, caption })).toBe(UNTAGGED_PHOTO_GROUP)
    expect(photoGroupTag({ section_tag: ` ${caption} `, caption: `${caption} ` })).toBe(UNTAGGED_PHOTO_GROUP)
    expect(photoGroupTag({ section_tag: '', caption })).toBe(UNTAGGED_PHOTO_GROUP)
    expect(photoGroupTag({ section_tag: 'Plumbing', caption })).toBe('Plumbing')
    expect(photoGroupTag(null)).toBe(UNTAGGED_PHOTO_GROUP)
  })

  it('groups in first seen order', () => {
    const groups = groupPhotosByTag([
      { section_tag: 'Roof', caption: 'a' },
      { section_tag: 'b', caption: 'b' },
      { section_tag: 'Roof', caption: null },
      { section_tag: null, caption: 'c' }
    ])
    expect([...groups.keys()]).toEqual(['Roof', UNTAGGED_PHOTO_GROUP])
    expect(groups.get('Roof')).toHaveLength(2)
    expect(groups.get(UNTAGGED_PHOTO_GROUP)).toHaveLength(2)
  })
})
