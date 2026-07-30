import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const baseline = process.argv[2] || '4255b6e'
const allowedColors = new Set([
  '#C9963A',
  '#141414',
  '#F2EDE4',
  '#5C5C5C',
  '#C0392B',
  '#2D7A4F'
])
const allowedRgb = new Set([
  '201,150,58',
  '20,20,20',
  '242,237,228',
  '92,92,92',
  '192,57,43',
  '45,122,79'
])
const allowedType = new Set([12, 14, 16, 20, 24])
const allowedSpacing = new Set([0, 4, 8, 12, 16, 24, 32, 48])
const counts = new Map()

function row(file) {
  const value = counts.get(file) || {
    colors: 0,
    radii: 0,
    type: 0,
    spacing: 0,
    tracking: 0
  }
  counts.set(file, value)
  return value
}

function expandedHex(value) {
  if (value.length !== 4) return value.toUpperCase()
  return `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join('')}`.toUpperCase()
}

function countRemovedLine(file, line) {
  const value = row(file)

  for (const match of line.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
    if (!allowedColors.has(expandedHex(match[0]))) value.colors += 1
  }
  for (const match of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    if (!allowedRgb.has(`${match[1]},${match[2]},${match[3]}`)) value.colors += 1
  }

  for (const match of line.matchAll(/borderRadius:\s*(\d+)|border-radius:\s*(\d+)px/gi)) {
    if (Number(match[1] || match[2]) !== 10) value.radii += 1
  }
  value.radii += [...line.matchAll(/borderRadius:\s*['"](?:50%|999px)['"]|border-radius:\s*50%/gi)].length
  value.radii += [...line.matchAll(/\brounded(?:-[trbl])?-(?:full|sm|md|lg|xl|2xl|3xl)\b/g)].length

  for (const match of line.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)|font-size:\s*(\d+(?:\.\d+)?)px/gi)) {
    if (!allowedType.has(Number(match[1] || match[2]))) value.type += 1
  }
  value.type += [...line.matchAll(/fontSize:\s*['"]clamp\(|font-size:\s*clamp\(/gi)].length
  value.type += [...line.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]|\btext-(?:lg|[3-9]xl)\b/g)].length

  for (const match of line.matchAll(/\b(?:padding(?:Top|Right|Bottom|Left|Horizontal|Vertical)?|gap|rowGap|columnGap):\s*(\d+(?:\.\d+)?)/gi)) {
    if (!allowedSpacing.has(Number(match[1]))) value.spacing += 1
  }
  for (const match of line.matchAll(/\b(?:padding(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap):\s*([^;,}\r\n]+)/gi)) {
    for (const px of match[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
      if (!allowedSpacing.has(Number(px[1]))) value.spacing += 1
    }
  }
  value.spacing += [...line.matchAll(/\b(?:p[trblxy]?|gap(?:-[xy])?)-(?:0\.5|1\.5|2\.5|3\.5|5|7)\b/g)].length
  value.tracking += [...line.matchAll(/\btracking-(?:tight|tighter|wide|wider|widest)\b/g)].length
  for (const match of line.matchAll(/letterSpacing:\s*['"]?(-?\d+(?:\.\d+)?)(?:px|em)?|letter-spacing:\s*(-?\d+(?:\.\d+)?)(?:px|em)?/gi)) {
    if (Number(match[1] || match[2]) !== 0) value.tracking += 1
  }
}

const diff = execFileSync(
  'git',
  ['diff', '--unified=0', '--no-ext-diff', baseline, '--', 'src', 'mobile', 'netlify', 'index.html'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)

let file = ''
for (const line of diff.split('\n')) {
  const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
  if (header) {
    file = header[2]
    continue
  }
  if (!file || !line.startsWith('-') || line.startsWith('---')) continue
  countRemovedLine(file, line.slice(1))
}

const rows = [...counts]
  .map(([name, value]) => ({
    name,
    ...value,
    total: value.colors + value.radii + value.type + value.spacing + value.tracking
  }))
  .filter((value) => value.total > 0)
  .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

const totals = rows.reduce(
  (sum, value) => ({
    colors: sum.colors + value.colors,
    radii: sum.radii + value.radii,
    type: sum.type + value.type,
    spacing: sum.spacing + value.spacing,
    tracking: sum.tracking + value.tracking,
    total: sum.total + value.total
  }),
  { colors: 0, radii: 0, type: 0, spacing: 0, tracking: 0, total: 0 }
)

const markdown = [
  '# Design System Replacement Report',
  '',
  `Baseline: \`${baseline}\``,
  '',
  'Counts are removed off-token declarations in the completed design sweep. Generated code and database type files are excluded by the design audit.',
  '',
  `Total replacements: **${totals.total.toLocaleString()}** across **${rows.length} files**.`,
  '',
  '| File | Colors | Radii | Type | Spacing | Tracking | Total |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map((value) => `| \`${value.name}\` | ${value.colors} | ${value.radii} | ${value.type} | ${value.spacing} | ${value.tracking} | ${value.total} |`),
  '',
  '## Totals',
  '',
  `Colors: ${totals.colors.toLocaleString()}`,
  '',
  `Radii: ${totals.radii.toLocaleString()}`,
  '',
  `Type: ${totals.type.toLocaleString()}`,
  '',
  `Spacing: ${totals.spacing.toLocaleString()}`,
  '',
  `Tracking: ${totals.tracking.toLocaleString()}`,
  ''
].join('\n')

writeFileSync(join(root, 'DESIGN_SYSTEM_REPLACEMENTS.md'), markdown)
console.log(`Wrote DESIGN_SYSTEM_REPLACEMENTS.md with ${totals.total} replacements across ${rows.length} files`)
