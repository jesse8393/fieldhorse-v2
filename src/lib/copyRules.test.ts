// Copy rules the redesign spec locks (section 4): the product never says
// "general contractor". Scans every source file under src, without the
// comments, so a string a person could read is caught wherever it lives.
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

describe('copy rules', () => {
  it('no screen says general contractor', () => {
    const files = sourceFiles(srcDir)
    expect(files.some((f) => f.endsWith('Landing.tsx'))).toBe(true)
    const hits = files.filter((file) => /general contractor/i.test(withoutComments(readFileSync(file, 'utf8'))))
    expect(hits.map((f) => f.slice(srcDir.length + 1))).toEqual([])
  })

  // The owner's name stays out of the whole repository: screens, code
  // notes, docs, plans and test data. The words are spelled in pieces so
  // this file passes its own check.
  const ownerName = new RegExp(`\\b(${['jes', 'se'].join('')}|${['par', 'ker'].join('')})`, 'i')
  // No ship rank wording either, on any screen or in any note.
  const shipRank = new RegExp(['cap', 't(ai|ia)', 'n'].join(''), 'i')
  const binary = /\.(png|jpe?g|webp|gif|ico|pdf|woff2?|ttf|otf|mp4|mov|zip|gz)$/i

  function trackedTextFiles() {
    return execSync('git ls-files', { cwd: process.cwd(), encoding: 'utf8' })
      .split('\n')
      .filter((file) => file && !binary.test(file))
  }

  it('the owner name appears in no tracked file', () => {
    const files = trackedTextFiles()
    expect(files.length).toBeGreaterThan(100)
    const hits = files.filter((file) => ownerName.test(readFileSync(join(process.cwd(), file), 'utf8')))
    expect(hits).toEqual([])
  })

  it('no ship rank wording anywhere', () => {
    const hits = trackedTextFiles().filter((file) => shipRank.test(readFileSync(join(process.cwd(), file), 'utf8')))
    expect(hits).toEqual([])
  })
})
