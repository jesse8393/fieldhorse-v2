import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, matchesGlob, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// PERF-11: the service worker precache downloads every listed chunk on
// install and on each deploy, for every user, phone or desktop. jsPDF and
// its table plugin (about 125 KB gzip) and the desktop builds stay out of
// it; the runtime cache keeps them once a screen has loaded them. That is
// only safe while nothing precached imports the PDF code statically.

const root = join(__dirname, '..', '..')
const config = readFileSync(join(root, 'vite.config.js'), 'utf8')
const ignores = [...(config.match(/globIgnores:\s*\[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
const ignored = (file: string) => ignores.some((pattern) => matchesGlob(file, pattern))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('what the service worker precaches', () => {
  it('leaves out jsPDF, its table plugin and the desktop builds', () => {
    for (const chunk of [
      'assets/vendor-jspdf-CJculaDE.js',
      'assets/vendor-pdf-table-DEZvi-_-.js',
      'assets/SnowHomeBuild-BIY_pIgW.js',
      'assets/SnowHomeBuild-CAhX9DRo.css',
      'assets/SnowInvoicesBuild-CGwnnKI_.js',
    ]) expect(ignored(chunk), chunk).toBe(true)
  })

  it('keeps the phone screens and the app shell', () => {
    for (const chunk of ['assets/index-DF7q0oix.js', 'assets/Schedule-abc123.js', 'assets/vendor-react-BqPSQ1Ch.js', 'index.html'])
      expect(ignored(chunk), chunk).toBe(false)
  })

  it('has no screen that imports the PDF code statically', () => {
    const statics = sourceFiles(join(root, 'src'))
      .filter((file) => /^\s*import\s[^;]*from\s+['"][./]*[^'"]*\/pdf\.js['"]/m.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
    expect(statics).toEqual([])
  })
})
