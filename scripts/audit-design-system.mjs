import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const extensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx'])
const allowedColors = new Set([
  '#C9963A',
  '#141414',
  '#F2EDE4',
  '#5C5C5C',
  '#C0392B',
  '#2D7A4F'
])
const allowedSpacing = new Set([0, 4, 8, 12, 16, 24, 32, 48])
const allowedType = new Set([12, 14, 16, 20, 24])
const allowedRgb = new Set([
  '201,150,58',
  '20,20,20',
  '242,237,228',
  '92,92,92',
  '192,57,43',
  '45,122,79'
])
const violations = new Map()

function add(file, line, message) {
  const key = relative(root, file).replaceAll('\\', '/')
  const entries = violations.get(key) || []
  entries.push(`${line}: ${message}`)
  violations.set(key, entries)
}

function walk(directory) {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name)
      if (name === 'node_modules' || name === 'dist' || name === 'test-results') return []
      return statSync(path).isDirectory() ? walk(path) : [path]
    })
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

for (const base of ['src', 'mobile']) {
  for (const file of walk(join(root, base))) {
    if (!extensions.has(extname(file)) || file.endsWith('database.types.ts')) continue
    const text = readFileSync(file, 'utf8')

    for (const match of text.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
      const color = match[0].length === 4
        ? `#${[...match[0].slice(1)].map((digit) => digit.repeat(2)).join('')}`.toUpperCase()
        : match[0].toUpperCase()
      if (!allowedColors.has(color)) add(file, lineAt(text, match.index), `off palette color ${match[0]}`)
    }

    for (const match of text.matchAll(/borderRadius:\s*(\d+)|border-radius:\s*(\d+)px/gi)) {
      const value = Number(match[1] || match[2])
      if (value !== 10 && value !== 999) add(file, lineAt(text, match.index), `raw radius ${value}`)
    }

    for (const match of text.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)|font-size:\s*(\d+(?:\.\d+)?)px/gi)) {
      const value = Number(match[1] || match[2])
      if (!allowedType.has(value)) add(file, lineAt(text, match.index), `off scale type ${value}`)
    }

    for (const match of text.matchAll(/fontSize:\s*['"]clamp\(|font-size:\s*clamp\(/gi)) {
      add(file, lineAt(text, match.index), `responsive type ${match[0]}`)
    }

    for (const match of text.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
      const tuple = `${match[1]},${match[2]},${match[3]}`
      if (!allowedRgb.has(tuple)) add(file, lineAt(text, match.index), `off palette rgb ${tuple}`)
    }

    const spacingPattern = /\b(?:padding(?:Top|Right|Bottom|Left|Horizontal|Vertical)?|gap|rowGap|columnGap):\s*(\d+(?:\.\d+)?)/gi
    for (const match of text.matchAll(spacingPattern)) {
      const value = Number(match[1])
      if (!allowedSpacing.has(value)) add(file, lineAt(text, match.index), `off scale spacing ${value}`)
    }

    const cssSpacingPattern = /\b(?:padding(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap):\s*([^;,}\r\n]+)/gi
    for (const match of text.matchAll(cssSpacingPattern)) {
      for (const px of match[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const value = Number(px[1])
        if (!allowedSpacing.has(value)) add(file, lineAt(text, match.index), `off scale spacing ${value}px`)
      }
    }

    const isBadgeFile = /(?:^|[\\/])(?:Badge|StatusPill)\.(?:tsx?|jsx?)$/i.test(file)
    for (const match of text.matchAll(/\brounded(?:-[trbl])?-(full|sm|md|lg|xl|2xl|3xl)\b/g)) {
      if (match[1] !== 'full' || !isBadgeFile) {
        add(file, lineAt(text, match.index), `non token radius utility ${match[0]}`)
      }
    }

    for (const match of text.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]|\btext-(lg|[3-9]xl)\b/g)) {
      add(file, lineAt(text, match.index), `off scale type utility ${match[0]}`)
    }

    for (const match of text.matchAll(/\b(?:p[trblxy]?|gap(?:-[xy])?)-(0\.5|1\.5|2\.5|3\.5|5|7)\b/g)) {
      add(file, lineAt(text, match.index), `off scale spacing utility ${match[0]}`)
    }

    for (const match of text.matchAll(/\btracking-(?!\[0px\])(?:tight|tighter|wide|wider|widest)\b/g)) {
      add(file, lineAt(text, match.index), `nonzero tracking utility ${match[0]}`)
    }
  }
}

const v3Css = readFileSync(join(root, 'src/styles/v3.css'), 'utf8')
const buttonContracts = [
  [/\.v3-btn\s*\{[\s\S]*?height:\s*40px;[\s\S]*?font-size:\s*14px;/, 'md button must be 40px and 14px'],
  [/\.v3-btn--sm\s*\{[^}]*height:\s*32px;[^}]*font-size:\s*12px;/, 'sm button must be 32px and 12px'],
  [/\.v3-btn--lg\s*\{[^}]*height:\s*44px;[^}]*font-size:\s*16px;/, 'lg button must be 44px and 16px']
]

for (const [pattern, message] of buttonContracts) {
  if (!pattern.test(v3Css)) add(join(root, 'src/styles/v3.css'), 1, message)
}

if (violations.size > 0) {
  for (const [file, entries] of [...violations].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`${file}\t${entries.length}`)
    for (const entry of entries.slice(0, 8)) console.error(`  ${entry}`)
    if (entries.length > 8) console.error(`  and ${entries.length - 8} more`)
  }
  process.exitCode = 1
} else {
  console.log('Design system audit passed')
}
