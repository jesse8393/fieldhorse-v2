// scripts/find-dead-css.mjs decides which CSS rules `--remove` may delete,
// so its rules are pinned here on a small fixture app (Vitest only collects
// files under src, so the script is run from this test through ROOT_DIR).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'find-dead-css.mjs')

const FILES: Record<string, string> = {
  'src/App.tsx': [
    "export function App({ size, state, block, x }: any) {",
    "  const id = `ovid-${x}`",
    "  return (",
    "    <div className={`fhx-${size}`} id={id}>",
    "      <Overlay overlayClassName={`ovl--${state}`} contentClass={`pane-${size}`} />",
    "      <div className={`${block}--open`} />",
    "      <span className=\"live-one\" />",
    "    </div>",
    "  )",
    "}",
  ].join('\n'),
  'src/App.test.tsx': "it('mentions a class', () => { document.querySelector('.only-in-test') })",
  'netlify/functions/mail.js': "export const html = '<div class=\"mail-card\">Hi</div>'",
  'index.html': '<!doctype html><div class="boot-splash"></div>',
  'src/styles/app.css': [
    '.live-one { color: red; }',
    '.fhx-wide { width: 100%; }',
    '.ovid-main { color: blue; }',
    '.ovl--shown { opacity: 1; }',
    '.pane-large { padding: 8px; }',
    '.card--open { display: block; }',
    '.mail-card { margin: 0; }',
    '.boot-splash { margin: 0; }',
    '.only-in-test { margin: 0; }',
    '.live-one, .gone-too { color: green; }',
    '.live-one { animation: used-spin 1s; }',
    '@keyframes used-spin { to { transform: rotate(1turn); } }',
    '@keyframes lonely-spin { to { transform: rotate(1turn); } }',
    '@media (min-width: 900px) { .gone-wide { color: red; } }',
    '@media print { @page { margin: 12mm; } }',
    '@supports (font-variation-settings: normal) { @font-face { font-family: X; src: local(X); } }',
  ].join('\n'),
}

let root = ''
let out = ''

// The lines of one titled list in the report, up to the next title.
function section(title: string): string {
  const at = out.indexOf(`\n${title}\n`)
  if (at === -1) return ''
  const rest = out.slice(at + title.length + 2)
  const next = rest.search(/\n[a-z][a-z ]+:\n/)
  return next === -1 ? rest : rest.slice(0, next)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'find-dead-css-'))
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  out = execFileSync(process.execPath, [SCRIPT, '--all'], { env: { ...process.env, ROOT_DIR: root }, encoding: 'utf8' })
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('find-dead-css', () => {
  it('keeps a class built from a template in a className', () => {
    expect(out).not.toContain('.fhx-wide')
  })

  it('keeps a class built in any prop whose name ends in ClassName or Class', () => {
    expect(out).not.toContain('.ovl--shown')
    expect(out).not.toContain('.pane-large')
  })

  it('protects no prefix from a template outside a class context', () => {
    expect(section('dead rules:')).toContain('.ovid-main')
  })

  it('counts netlify code and the HTML files as use', () => {
    expect(out).not.toContain('.mail-card')
    expect(out).not.toContain('.boot-splash')
  })

  it('never counts a test file as use', () => {
    expect(section('dead rules:')).toContain('.only-in-test')
  })

  it('lists a class a variable could end as unknown, never dead', () => {
    expect(section('dead rules:')).not.toContain('.card--open')
    expect(section('unknown rules:')).toContain('.card--open')
  })

  it('lists a dead selector inside a live rule', () => {
    expect(section('dead selectors in live rules:')).toContain('.gone-too')
  })

  it('lists keyframes nothing animates, and keeps the ones a rule uses', () => {
    expect(section('unused keyframes:')).toContain('lonely-spin')
    expect(section('unused keyframes:')).not.toContain('used-spin')
  })

  it('lists a block as empty once its only rule is dead', () => {
    expect(section('empty blocks:')).toContain('@media (min-width: 900px)')
  })

  it('never lists a block that holds only @page or @font-face as empty', () => {
    expect(section('empty blocks:')).not.toContain('@media print')
    expect(section('empty blocks:')).not.toContain('@supports')
  })
})
