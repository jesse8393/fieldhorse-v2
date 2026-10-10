#!/usr/bin/env node
// Finds CSS rule blocks that no screen can match any more (Phase 7, Task 7.2).
//
// A class selector is dead when its class name appears nowhere in the
// app: not in src/**/*.{ts,tsx,js,jsx,mjs}, index.html, public/*.js, nor in
// a template string or string concatenation whose prefix could build it
// (for example `fh-stage-pill--${stage}` keeps every fh-stage-pill--*).
// A selector is dead when it needs a dead class (classes inside :not(),
// :is(), :where() and :has() do not count, they are optional). A rule block
// is dead only when every selector in its list is dead.
//
// Usage:
//   node scripts/find-dead-css.mjs                 print a summary and the first rules
//   node scripts/find-dead-css.mjs --all           print every dead rule
//   node scripts/find-dead-css.mjs --remove 0 100  remove dead rules 0 to 99 in place
//
// Rules are numbered in file order across the three files, so removing a
// batch is repeatable: restore the files with git, then pass a smaller count.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.env.ROOT_DIR || join(import.meta.dirname, '..')
const CSS_FILES = ['src/styles/global.css', 'src/styles/v3.css', 'src/styles/fixes-2026-07.css']

// ---- 1. What the app uses ----------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue
      walk(path, out)
    } else out.push(path)
  }
  return out
}

const sources = [
  ...walk(join(ROOT, 'src')).filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f)),
  ...(existsSync(join(ROOT, 'index.html')) ? [join(ROOT, 'index.html')] : []),
  ...(existsSync(join(ROOT, 'public')) ? walk(join(ROOT, 'public')).filter((f) => /\.(js|html)$/.test(f)) : [])
]

const words = new Set()
const prefixes = new Set()
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/[A-Za-z_][\w-]*/g)) words.add(m[0])
  // `prefix-${x}` inside a template string, and 'prefix-' + x or "prefix-".concat
  for (const m of text.matchAll(/([A-Za-z_][\w-]*[-_])\$\{/g)) prefixes.add(m[1])
  for (const m of text.matchAll(/['"`]([A-Za-z_][\w-]*[-_])['"`]\s*(?:\+|\.concat)/g)) prefixes.add(m[1])
}

// Other CSS files can mention a class too (a rule in v3.css that styles a
// class defined nowhere else is dead, but a class only toggled by CSS is not
// a thing), so only code counts as use.
function classIsUsed(name) {
  if (words.has(name)) return true
  for (const p of prefixes) if (p.length >= 3 && name.startsWith(p)) return true
  return false
}

// ---- 2. Parse the CSS into rule blocks ----------------------------------

// Returns top level and nested style rules as { start, end, selector, depth }
// where start and end index the full text of the rule (selector through the
// closing brace). At-rules that hold rules (@media, @supports, @layer,
// @container) are walked into; other at-rules (@keyframes, @font-face,
// @property) are skipped whole.
function parseRules(css) {
  const rules = []
  const n = css.length

  function skipString(i, quote) {
    for (i += 1; i < n; i++) {
      if (css[i] === '\\') { i += 1; continue }
      if (css[i] === quote) return i
    }
    return n - 1
  }

  function skipComment(i) {
    const end = css.indexOf('*/', i + 2)
    return end === -1 ? n - 1 : end + 1
  }

  // From an opening brace at `open`, find its matching close brace.
  function matchBrace(open) {
    let depth = 0
    for (let i = open; i < n; i++) {
      const c = css[i]
      if (c === '"' || c === "'") i = skipString(i, c)
      else if (c === '/' && css[i + 1] === '*') i = skipComment(i)
      else if (c === '(') {
        // url(data:...) and other parens: skip to the matching paren, honoring strings
        let d = 1
        for (i += 1; i < n && d > 0; i++) {
          const ch = css[i]
          if (ch === '"' || ch === "'") i = skipString(i, ch)
          else if (ch === '(') d += 1
          else if (ch === ')') d -= 1
        }
        i -= 1
      } else if (c === '{') depth += 1
      else if (c === '}') { depth -= 1; if (depth === 0) return i }
    }
    return n - 1
  }

  function walkBlock(from, to, depth) {
    let i = from
    while (i < to) {
      // skip whitespace and comments
      while (i < to && /\s/.test(css[i])) i++
      if (css[i] === '/' && css[i + 1] === '*') { i = skipComment(i) + 1; continue }
      if (i >= to) break
      const start = i
      // read a prelude up to { or ;
      let j = i
      let open = -1
      for (; j < to; j++) {
        const c = css[j]
        if (c === '"' || c === "'") j = skipString(j, c)
        else if (c === '/' && css[j + 1] === '*') j = skipComment(j)
        else if (c === '(') {
          let d = 1
          for (j += 1; j < to && d > 0; j++) {
            const ch = css[j]
            if (ch === '"' || ch === "'") j = skipString(j, ch)
            else if (ch === '(') d += 1
            else if (ch === ')') d -= 1
          }
          j -= 1
        } else if (c === '{') { open = j; break }
        else if (c === ';') break
      }
      if (open === -1) { i = j + 1; continue } // a declaration or @import
      const close = matchBrace(open)
      const prelude = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container|document)\b/.test(prelude)) walkBlock(open + 1, close, depth + 1)
      } else {
        rules.push({ start, end: close + 1, selector: prelude, depth })
        // nested style rules (CSS nesting) are left alone with their parent
      }
      i = close + 1
    }
  }

  walkBlock(0, n, 0)
  return rules
}

// ---- 3. Is a selector dead? ---------------------------------------------

function splitSelectors(list) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const c of list) {
    if (c === '(' || c === '[') depth += 1
    if (c === ')' || c === ']') depth -= 1
    if (c === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

function requiredClasses(selector) {
  // drop optional groups and attribute selectors, then read the class names
  let s = selector.replace(/\[[^\]]*\]/g, '')
  let prev
  do {
    prev = s
    s = s.replace(/:(?:not|is|where|has|matches)\([^()]*\)/g, '')
  } while (s !== prev)
  return [...s.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1])
}

function ruleIsDead(rule) {
  const selectors = splitSelectors(rule.selector)
  if (selectors.length === 0) return false
  return selectors.every((sel) => requiredClasses(sel).some((c) => !classIsUsed(c)))
}

// ---- 4. Run ---------------------------------------------------------------

const found = []
for (const file of CSS_FILES) {
  const css = readFileSync(join(ROOT, file), 'utf8')
  for (const rule of parseRules(css)) {
    if (ruleIsDead(rule)) found.push({ file, ...rule, bytes: rule.end - rule.start })
  }
}

const args = process.argv.slice(2)
if (args[0] === '--remove') {
  const from = Number(args[1])
  const count = Number(args[2])
  const batch = found.slice(from, from + count)
  const byFile = new Map()
  for (const r of batch) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file).push(r)
  }
  for (const [file, list] of byFile) {
    let css = readFileSync(join(ROOT, file), 'utf8')
    // from the end so earlier offsets stay valid; swallow the blank line after
    for (const r of list.sort((a, b) => b.start - a.start)) {
      let end = r.end
      while (css[end] === '\n' || css[end] === '\r') end += 1
      css = css.slice(0, r.start) + css.slice(end)
    }
    writeFileSync(join(ROOT, file), css)
  }
  console.log(`removed ${batch.length} rules (numbers ${from} to ${from + batch.length - 1}) from ${byFile.size} files`)
} else {
  const total = found.reduce((a, r) => a + r.bytes, 0)
  console.log(`${found.length} dead rules, ${(total / 1024).toFixed(1)} KB, in ${CSS_FILES.length} files`)
  for (const file of CSS_FILES) {
    const mine = found.filter((r) => r.file === file)
    console.log(`  ${file}: ${mine.length} rules, ${(mine.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(1)} KB`)
  }
  const shown = args[0] === '--all' ? found : found.slice(0, 15)
  shown.forEach((r, i) => console.log(`${String(i).padStart(4)} ${relative(ROOT, join(ROOT, r.file))} ${r.selector.replace(/\s+/g, ' ').slice(0, 110)}`))
  console.log(`classes used: ${words.size} words, ${prefixes.size} dynamic prefixes`)
}
