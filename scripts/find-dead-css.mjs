#!/usr/bin/env node
// Finds CSS the app can no longer use (Phase 7, Task 7.2; widened in Phase 8,
// Task 17). It reads every CSS file under src and reports four things:
//
//   dead rules        rule blocks every selector of which needs a class the
//                     app never uses
//   dead selectors    such selectors inside a rule list that also has a live
//                     selector: the rule stays, the selector can go
//   unused keyframes  @keyframes no animation names, in a rule that stays or
//                     in the code
//   empty blocks      @media, @supports, @container and @layer blocks with no
//                     rule left in them once the dead rules are gone
//
// A class is used when its name appears in the app's code: the scripts under
// src (tests left out), netlify/ and public/, and the HTML files (index.html
// and the HTML under src, public and netlify). A class built from a variable
// is used when a class context (className, class, any prop ending in
// ClassName or Class, cx(), clsx(), classNames() or a classList method) holds a template string or a concatenation whose
// fixed start could build it: cx('fhc-chip', `fhc-chip--${tone}`) keeps every
// fhc-chip--*. A fixed start anywhere else (an id, a file name, a storage key)
// protects nothing.
//
// A name a variable starts and a fixed part ends, `${block}--open` or
// `${block}__title`, could build a class no search can read, so every class
// ending in --open (or __title) is unknown, never dead, and `${a}--${b}` makes
// every class with -- in it unknown. Rules that need an unknown class are
// listed apart and never removed.
//
// A selector needs every class outside :not(), :is(), :where(), :has() and
// :matches(), which are optional.
//
// Usage:
//   node scripts/find-dead-css.mjs                 print a summary and the first findings
//   node scripts/find-dead-css.mjs --all           print every finding
//   node scripts/find-dead-css.mjs --remove 0 100  remove dead rules 0 to 99 in place
//
// Dead rules are numbered in file order across the files, so removing a
// batch is repeatable: restore the files with git, then pass a smaller count.
// Dead selectors, unused keyframes and empty blocks are only listed; take
// them out by hand, with the comments that describe them.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.env.ROOT_DIR || join(import.meta.dirname, '..')

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git' || name === '.netlify') continue
      walk(path, out)
    } else out.push(path)
  }
  return out
}

const rel = (path) => relative(ROOT, path)

const CSS_FILES = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.css')).map(rel).sort()

// ---- 1. What the app uses ----------------------------------------------

const CODE = /\.(tsx?|jsx?|mjs|cjs)$/
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/
const HTML = /\.html?$/

const sources = [
  ...walk(join(ROOT, 'src')).filter((f) => (CODE.test(f) && !TEST.test(f)) || HTML.test(f)),
  ...walk(join(ROOT, 'netlify')).filter((f) => (CODE.test(f) && !TEST.test(f)) || HTML.test(f)),
  ...walk(join(ROOT, 'public')).filter((f) => CODE.test(f) || HTML.test(f)),
  ...readdirSync(ROOT).filter((name) => HTML.test(name)).map((name) => join(ROOT, name))
]

// Reads from text[i], an opening quote or backtick, to its closing one, and
// returns the index of the closing character. Template strings may nest
// ${...} with strings of their own inside.
function skipString(text, i) {
  const quote = text[i]
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') { j += 1; continue }
    if (c === quote) return j
    if (quote === '`' && c === '$' && text[j + 1] === '{') j = skipBalanced(text, j + 1, '{', '}')
    else if (quote !== '`' && c === '\n') return j
  }
  return text.length - 1
}

// From an opening bracket at text[i], the index of its matching close,
// skipping strings, template strings and comments.
function skipBalanced(text, i, open, close) {
  let depth = 0
  for (let j = i; j < text.length; j++) {
    const c = text[j]
    if (c === '"' || c === "'" || c === '`') j = skipString(text, j)
    else if (c === '/' && text[j + 1] === '/') j = text.indexOf('\n', j) === -1 ? text.length : text.indexOf('\n', j)
    else if (c === '/' && text[j + 1] === '*') j = text.indexOf('*/', j + 2) === -1 ? text.length : text.indexOf('*/', j + 2) + 1
    else if (c === open) depth += 1
    else if (c === close) { depth -= 1; if (depth === 0) return j }
  }
  return text.length - 1
}

// The text of each class context: the value of a className or class
// attribute or property (or any prop whose name ends in ClassName or Class,
// such as overlayClassName or variantClass), and the arguments of cx(),
// clsx(), classNames() and the classList methods.
const CONTEXT = /\b(?:className|class|\w+ClassName|\w+Class)\s*[=:]\s*|\b(?:cx|clsx|classNames)\s*\(|\bclassList\s*\.\s*(?:add|remove|toggle|replace|contains)\s*\(/g

function classContexts(text) {
  const found = []
  for (const m of text.matchAll(CONTEXT)) {
    const at = m.index + m[0].length
    if (m[0].endsWith('(')) {
      found.push(text.slice(at, skipBalanced(text, at - 1, '(', ')')))
      continue
    }
    const c = text[at]
    if (c === '{') found.push(text.slice(at, skipBalanced(text, at, '{', '}') + 1))
    else if (c === '"' || c === "'" || c === '`') found.push(text.slice(at, skipString(text, at) + 1))
    else {
      // A plain expression: up to the end of the property or statement.
      let j = at
      for (; j < text.length; j++) {
        const ch = text[j]
        if (ch === '"' || ch === "'" || ch === '`') j = skipString(text, j)
        else if (ch === '(') j = skipBalanced(text, j, '(', ')')
        else if (ch === '[') j = skipBalanced(text, j, '[', ']')
        else if (ch === '{') j = skipBalanced(text, j, '{', '}')
        else if (',;)}]>\n'.includes(ch)) break
      }
      found.push(text.slice(at, j))
    }
  }
  return found
}

const words = new Set()
const prefixes = new Set()
// Endings a variable start could carry: '--open' keeps every class ending
// in --open; a bare '--' or '__' keeps every class holding one.
const unknownEndings = new Set()
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/[A-Za-z_][\w-]*/g)) words.add(m[0])
  for (const context of classContexts(text)) {
    // `prefix-${x}` inside a template string, and 'prefix-' + x or 'prefix-'.concat(x)
    for (const m of context.matchAll(/([A-Za-z_][\w-]*[-_])\$\{/g)) prefixes.add(m[1])
    for (const m of context.matchAll(/['"`]([A-Za-z_][\w-]*[-_])['"`]\s*(?:\+|\.concat\b)/g)) prefixes.add(m[1])
  }
  // `${x}--open`, `${x}__title`, `${a}--${b}`, and x + '--open'
  for (const m of text.matchAll(/\$\{[^{}]*\}(--|__)([A-Za-z0-9_-]*)/g)) unknownEndings.add(m[1] + m[2])
  for (const m of text.matchAll(/\+\s*['"`](--|__)([A-Za-z0-9_-]*)/g)) unknownEndings.add(m[1] + m[2])
}

// 'used', 'unknown' or 'dead'. Other CSS files can mention a class too, but
// a class only CSS names is never on a page, so only code counts as use.
function classState(name) {
  if (words.has(name)) return 'used'
  for (const p of prefixes) if (p.length >= 3 && name.startsWith(p)) return 'used'
  for (const ending of unknownEndings) {
    if (ending.length === 2 ? name.includes(ending) : name.endsWith(ending)) return 'unknown'
  }
  return 'dead'
}

// ---- 2. Parse the CSS --------------------------------------------------

// Returns the file's style rules ({ start, end, selector, body, parents }),
// grouping blocks ({ start, end, prelude, parents }: @media, @supports,
// @layer, @container, @document), @keyframes ({ start, end, name,
// parents }) and other at-rules with a body ({ start, end, prelude,
// parents }: @font-face, @page and the like). start and end index the whole text of each, from its prelude
// through its closing brace; parents lists the grouping blocks around it.
function parseCss(css) {
  const rules = []
  const blocks = []
  const keyframes = []
  const others = []
  const n = css.length

  function skipCssString(i) {
    const quote = css[i]
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

  function skipParens(i, to) {
    let d = 1
    for (i += 1; i < to && d > 0; i++) {
      const ch = css[i]
      if (ch === '"' || ch === "'") i = skipCssString(i)
      else if (ch === '(') d += 1
      else if (ch === ')') d -= 1
    }
    return i - 1
  }

  // From an opening brace at `open`, its matching close brace.
  function matchBrace(open) {
    let depth = 0
    for (let i = open; i < n; i++) {
      const c = css[i]
      if (c === '"' || c === "'") i = skipCssString(i)
      else if (c === '/' && css[i + 1] === '*') i = skipComment(i)
      else if (c === '(') i = skipParens(i, n)
      else if (c === '{') depth += 1
      else if (c === '}') { depth -= 1; if (depth === 0) return i }
    }
    return n - 1
  }

  function walkBlock(from, to, parents) {
    let i = from
    while (i < to) {
      while (i < to && /\s/.test(css[i])) i++
      if (css[i] === '/' && css[i + 1] === '*') { i = skipComment(i) + 1; continue }
      if (i >= to) break
      const start = i
      // a prelude, up to { or ;
      let j = i
      let open = -1
      for (; j < to; j++) {
        const c = css[j]
        if (c === '"' || c === "'") j = skipCssString(j)
        else if (c === '/' && css[j + 1] === '*') j = skipComment(j)
        else if (c === '(') j = skipParens(j, to)
        else if (c === '{') { open = j; break }
        else if (c === ';') break
      }
      if (open === -1) { i = j + 1; continue } // a declaration or @import
      const close = matchBrace(open)
      const prelude = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|layer|container|document)\b/.test(prelude)) {
          const block = { start, end: close + 1, prelude, parents }
          blocks.push(block)
          walkBlock(open + 1, close, [...parents, block])
        } else if (/^@(-webkit-)?keyframes\b/.test(prelude)) {
          keyframes.push({ start, end: close + 1, name: prelude.split(/\s+/)[1], parents })
        } else {
          // @font-face, @page, @property, @counter-style and the like: never
          // dead, and a block that holds one is not empty.
          others.push({ start, end: close + 1, prelude, parents })
        }
      } else {
        // Nested style rules (CSS nesting) stay part of their parent.
        rules.push({ start, end: close + 1, selector: prelude, body: css.slice(open + 1, close), parents })
      }
      i = close + 1
    }
  }

  walkBlock(0, n, [])
  return { rules, blocks, keyframes, others }
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
  return parts.map((s) => s.trim())
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

// 'live', 'unknown' or 'dead': dead when it needs a dead class, unknown when
// it needs a class a variable could build.
function selectorState(selector) {
  const states = requiredClasses(selector).map(classState)
  if (states.includes('dead')) return 'dead'
  if (states.includes('unknown')) return 'unknown'
  return 'live'
}

// ---- 4. Run ---------------------------------------------------------------

const deadRules = []
const deadSelectors = []
const unknownRules = []
const unusedKeyframes = []
const emptyBlocks = []
const parsed = CSS_FILES.map((file) => ({ file, css: readFileSync(join(ROOT, file), 'utf8') }))

const animated = new Set()
for (const { file, css } of parsed) {
  const { rules, blocks, keyframes, others } = parseCss(css)
  const staying = []
  for (const rule of rules) {
    const selectors = splitSelectors(rule.selector)
    const states = selectors.map(selectorState)
    if (states.length > 0 && states.every((s) => s === 'dead')) {
      deadRules.push({ file, ...rule, bytes: rule.end - rule.start })
      continue
    }
    staying.push(rule)
    if (states.every((s) => s !== 'live')) unknownRules.push({ file, ...rule })
    selectors.forEach((selector, k) => {
      if (states[k] === 'dead') deadSelectors.push({ file, start: rule.start, selector, list: rule.selector })
    })
    for (const m of rule.body.matchAll(/animation(?:-name)?\s*:\s*([^;}]*)/g)) {
      for (const name of m[1].match(/[A-Za-z_-][\w-]*/g) || []) animated.add(name)
    }
  }
  // A block is empty when no rule that stays, no keyframes, no other
  // at-rule (@page, @font-face) and no block with something in it sits
  // inside it.
  const holds = new Set()
  for (const item of [...staying, ...keyframes, ...others]) for (const parent of item.parents) holds.add(parent)
  for (const block of blocks) {
    if (!holds.has(block)) emptyBlocks.push({ file, ...block })
  }
  parsed.find((p) => p.file === file).keyframes = keyframes
}
for (const { file, keyframes } of parsed) {
  for (const k of keyframes) {
    if (!animated.has(k.name) && !words.has(k.name)) unusedKeyframes.push({ file, ...k })
  }
}

const lineOf = (file, index) => parsed.find((p) => p.file === file).css.slice(0, index).split('\n').length
const oneLine = (text, size = 110) => text.replace(/\s+/g, ' ').slice(0, size)

const args = process.argv.slice(2)
if (args[0] === '--remove') {
  const from = Number(args[1])
  const count = Number(args[2])
  const batch = deadRules.slice(from, from + count)
  const byFile = new Map()
  for (const r of batch) {
    if (!byFile.has(r.file)) byFile.set(r.file, [])
    byFile.get(r.file).push(r)
  }
  for (const [file, list] of byFile) {
    let css = readFileSync(join(ROOT, file), 'utf8')
    // From the end so earlier offsets stay valid. Take the rule's own
    // indentation and the line break after it too, so the next line keeps
    // its indentation instead of stacking it onto this one's, and leave one
    // blank line where the rule sat between two.
    for (const r of list.sort((a, b) => b.start - a.start)) {
      let start = r.start
      while (start > 0 && (css[start - 1] === ' ' || css[start - 1] === '\t')) start -= 1
      let end = r.end
      while (css[end] === ' ' || css[end] === '\t') end += 1
      if (css[end] === '\r') end += 1
      if (css[end] === '\n') end += 1
      const blankBefore = /\n[ \t]*\r?\n$/.test(css.slice(Math.max(0, start - 8), start))
      const blankAfter = /^[ \t]*\r?\n/.exec(css.slice(end, end + 8))
      if (blankBefore && blankAfter) end += blankAfter[0].length
      css = css.slice(0, start) + css.slice(end)
    }
    writeFileSync(join(ROOT, file), css)
  }
  console.log(`removed ${batch.length} rules (numbers ${from} to ${from + batch.length - 1}) from ${byFile.size} files`)
} else {
  const total = deadRules.reduce((a, r) => a + r.bytes, 0)
  console.log(`${deadRules.length} dead rules (${(total / 1024).toFixed(1)} KB), ${deadSelectors.length} dead selectors in live rules, ` +
    `${unusedKeyframes.length} unused keyframes, ${emptyBlocks.length} empty blocks, in ${CSS_FILES.length} files`)
  console.log(`${unknownRules.length} rules need a class a variable could build (unknown, never removed)`)
  for (const file of CSS_FILES) {
    const counts = [deadRules, deadSelectors, unusedKeyframes, emptyBlocks, unknownRules].map((list) => list.filter((r) => r.file === file).length)
    if (counts.some(Boolean)) {
      console.log(`  ${file}: ${counts[0]} dead rules, ${counts[1]} dead selectors, ${counts[2]} unused keyframes, ${counts[3]} empty blocks, ${counts[4]} unknown`)
    }
  }
  const limit = args[0] === '--all' ? Infinity : 15
  const list = (title, items, show) => {
    if (items.length === 0) return
    console.log(title)
    items.slice(0, limit).forEach((r, i) => console.log(`${String(i).padStart(4)} ${r.file}:${lineOf(r.file, r.start)} ${show(r)}`))
    if (items.length > limit) console.log(`     and ${items.length - limit} more (--all lists them)`)
  }
  list('dead rules:', deadRules, (r) => oneLine(r.selector))
  list('dead selectors in live rules:', deadSelectors, (r) => `${oneLine(r.selector, 60)}   in   ${oneLine(r.list, 60)}`)
  list('unused keyframes:', unusedKeyframes, (r) => r.name)
  list('empty blocks:', emptyBlocks, (r) => oneLine(r.prelude))
  list('unknown rules:', unknownRules, (r) => oneLine(r.selector))
  console.log(`classes used: ${words.size} words, ${prefixes.size} prefixes from class contexts, ${unknownEndings.size} endings a variable could start`)
}
