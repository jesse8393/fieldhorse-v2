// Contrast contract for the redesign tokens (spec section 12).
//
// Reads tokens.css and redesign.css as text, resolves the var() chains
// for Day (:root) and Night (:root plus [data-theme='dark']) and for the
// onyx scope, and measures every pair the spec promises with the WCAG
// 2.x relative luminance formula. A token edit that drops a pair below
// its threshold fails here before it reaches a screen.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesDir = join(process.cwd(), 'src', 'styles')
const tokensCss = readFileSync(join(stylesDir, 'tokens.css'), 'utf8')
const redesignCss = readFileSync(join(stylesDir, 'redesign.css'), 'utf8')

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`No ${selector} block`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++
    else if (css[end] === '}' && --depth === 0) break
  }
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) vars[m[1]] = m[2].trim()
  return vars
}

const day = block(tokensCss, ':root')
const night = { ...day, ...block(tokensCss, "[data-theme='dark']") }
const onyxDay = { ...day, ...block(redesignCss, '.fh-onyx-scope') }

function resolve(vars: Record<string, string>, name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`Cycle at ${name}`)
  const raw = vars[name]
  if (raw === undefined) throw new Error(`Undefined token ${name}`)
  const ref = raw.match(/^var\((--[a-z0-9-]+)\)$/i)
  if (ref) return resolve(vars, ref[1], [...seen, name])
  if (!/^#[0-9a-f]{6}$/i.test(raw)) throw new Error(`${name} is ${raw}, not a plain hex color`)
  return raw.toUpperCase()
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

type Pair = [fg: string, bg: string, min: number]

function check(vars: Record<string, string>, pairs: Pair[]) {
  for (const [fg, bg, min] of pairs) {
    const value = ratio(resolve(vars, fg), resolve(vars, bg))
    expect(value, `${fg} on ${bg} is ${value.toFixed(2)}:1, needs ${min}:1`).toBeGreaterThanOrEqual(min)
  }
}

const TEXT = 4.5
const UI = 3

// Pairs that must hold in both Day and Night.
const shared: Pair[] = [
  ['--fh-ink', '--fh-plaster', TEXT],
  ['--fh-ink', '--fh-paper', TEXT],
  ['--fh-ink', '--fh-tray', TEXT],
  ['--fh-ink-2', '--fh-plaster', TEXT],
  ['--fh-ink-2', '--fh-paper', TEXT],
  ['--fh-ink-2', '--fh-tray', TEXT],
  ['--fh-ink-3', '--fh-plaster', TEXT],
  ['--fh-ink-3', '--fh-paper', TEXT],
  ['--fh-ink-3', '--fh-tray', TEXT],
  ['--fh-gold-ink', '--fh-plaster', TEXT],
  ['--fh-gold-ink', '--fh-paper', TEXT],
  ['--fh-success-ink', '--fh-success-fill', TEXT],
  ['--fh-info-ink', '--fh-info-fill', TEXT],
  ['--fh-danger-ink', '--fh-danger-fill', TEXT],
  ['--fh-ink-2', '--fh-paper', TEXT],
  // Input outlines, rail segments and focus rings (non text, 3:1)
  ['--fh-edge-strong', '--fh-paper', UI],
  ['--fh-edge-strong', '--fh-plaster', UI],
  ['--fh-ink-4', '--fh-plaster', UI],
  ['--fh-focus', '--fh-plaster', UI],
  ['--fh-focus', '--fh-paper', UI],
  // Onyx stage text and markers
  ['--fh-linen', '--fh-onyx', TEXT],
  ['--fh-smoke', '--fh-onyx', TEXT],
  ['--fh-smoke', '--fh-onyx-2', TEXT],
  ['--fh-linen', '--fh-dock', TEXT],
  ['--fh-smoke', '--fh-dock', TEXT],
  ['--fh-focus-on-onyx', '--fh-onyx', UI],
  ['--fh-gold', '--fh-onyx', UI],
  // Ink on brushed gold, across the whole gradient
  ['--fh-on-gold', '--fh-gold-hi', TEXT],
  ['--fh-on-gold', '--fh-gold', TEXT],
  ['--fh-on-gold', '--fh-gold-lo', TEXT],
  // Legacy names that older screens still read
  ['--v3-text', '--v3-bg', TEXT],
  ['--v3-text', '--v3-surface', TEXT],
  ['--v3-text-secondary', '--v3-surface', TEXT],
  ['--v3-text-muted', '--v3-bg', TEXT],
  ['--v3-text-muted', '--v3-surface', TEXT],
  ['--v3-text-muted', '--v3-surface-2', TEXT],
  ['--v3-text-muted', '--v3-surface-3', TEXT],
  ['--v3-primary-text', '--v3-bg', TEXT],
  ['--v3-primary-text', '--v3-surface', TEXT],
  ['--v3-danger-text', '--v3-bg', TEXT],
  ['--v3-danger-text', '--v3-danger-soft', TEXT],
  ['--v3-success-text', '--v3-bg', TEXT],
  ['--v3-success-text', '--v3-success-soft', TEXT],
  ['--ink-strong', '--surface-0', TEXT],
  ['--ink-muted', '--surface-1', TEXT],
  ['--ink-faint', '--surface-2', TEXT],
  ['--v3-on-primary', '--v3-primary', TEXT]
]

describe('redesign token contrast (spec section 12)', () => {
  it('holds every pair in Day', () => {
    check(day, shared)
  })

  it('holds every pair in Night', () => {
    check(night, shared)
  })

  it('keeps text readable inside the onyx scope', () => {
    const onyxPairs: Pair[] = [
      ['--v3-text', '--fh-onyx', TEXT],
      ['--v3-text-secondary', '--fh-onyx', TEXT],
      ['--v3-text-muted', '--fh-onyx', TEXT],
      ['--v3-text-muted', '--fh-onyx-2', TEXT],
      ['--ink-muted', '--fh-onyx', TEXT],
      ['--v3-primary-text', '--fh-onyx', TEXT],
      ['--v3-danger-text', '--fh-onyx', TEXT],
      ['--v3-success-text', '--fh-onyx', TEXT],
      ['--fh-focus', '--fh-onyx', UI]
    ]
    check(onyxDay, onyxPairs)
  })

  it('keeps the spec figures it quotes', () => {
    // Spot checks against the numbers printed in spec section 12, so the
    // document and the tokens cannot drift apart unnoticed.
    const at = (vars: Record<string, string>, a: string, b: string) =>
      Number(ratio(resolve(vars, a), resolve(vars, b)).toFixed(1))
    expect(at(day, '--fh-ink', '--fh-plaster')).toBe(14.3)
    expect(at(day, '--fh-ink-3', '--fh-plaster')).toBe(5)
    expect(at(day, '--fh-on-gold', '--fh-gold-lo')).toBe(4.8)
    expect(at(day, '--fh-linen', '--fh-onyx')).toBe(15.8)
    expect(at(day, '--fh-smoke', '--fh-onyx')).toBe(5.9)
    expect(at(night, '--fh-ink-3', '--fh-tray')).toBe(4.8)
    expect(at(day, '--fh-edge-strong', '--fh-paper')).toBe(3.6)
  })
})
