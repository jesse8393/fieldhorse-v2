// Copy rules the redesign spec locks (section 4): the product never says
// "general contractor". Scans every source file under src, without the
// comments, so a string a person could read is caught wherever it lives.
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

  // OPS-21: the strings the phone audit found in the schedule, Today and
  // follow up files. Sentence case, and no dash standing in for a word.
  const OPS_FILES = [
    'screens/Schedule.tsx', 'screens/schedule/EventNew.tsx', 'screens/schedule/CrewAllocation.tsx',
    'components/v3/NextActionCard.tsx', 'lib/followUp.ts', 'screens/Notifications.tsx',
    'components/NotificationsBell.tsx', 'components/TimeClockCard.tsx', 'screens/MilesNew.tsx'
  ]
  const opsSource = (file: string) => withoutComments(readFileSync(join(srcDir, file), 'utf8'))

  it('uses no en or em dash as punctuation in the schedule, Today and follow up screens', () => {
    const hits = OPS_FILES.filter((file) => /[\u2013\u2014]/.test(opsSource(file)))
    expect(hits).toEqual([])
  })

  it('says Mark complete in sentence case', () => {
    expect(opsSource('components/v3/NextActionCard.tsx')).not.toMatch(/Mark Complete/)
  })

  it('counts recurring visits with the right noun', () => {
    expect(opsSource('screens/schedule/EventNew.tsx')).not.toMatch(/\{visitPreview\.length\} visits total/)
  })

  it('calls only the next visit of the day Up next', () => {
    const schedule = opsSource('screens/Schedule.tsx')
    expect(schedule).not.toMatch(/'Upcoming':\s*\{ variant: 'up',\s*label: 'Up next' \}/)
  })
})

// ai-copy-1: a dash swap once turned each "Label: what it means" line on
// the legal pages into "Label, what it means", which reads as a list
// ("Supabase, database, authentication, and file storage hosting" names
// four things). Each line names its subject and then says what it is.
describe('legal pages', () => {
  const legal = (file: string) => readFileSync(join(srcDir, 'screens', file), 'utf8')
  const listItems = (file: string) => [...legal(file).matchAll(/^\s*'([^']+)',?$/gm)].map((m) => m[1])

  it('starts no privacy policy line with a short label and a comma', () => {
    const items = listItems('Privacy.tsx')
    expect(items.length).toBeGreaterThan(10)
    expect(items.filter((item) => /^[A-Z][^,.:']{2,30}, /.test(item))).toEqual([])
  })

  it('says what your data is in the terms without a comma splice', () => {
    expect(legal('Terms.tsx').replace(/\s+/g, ' ')).not.toContain('into the Service, your jobs')
  })

  it('titles both pages in sentence case', () => {
    expect(legal('Privacy.tsx')).toContain('title="Privacy policy"')
    expect(legal('Terms.tsx')).toContain('title="Terms of service"')
  })
})
