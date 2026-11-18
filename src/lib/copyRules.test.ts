// Copy rules the redesign spec locks (section 4): the product never says
// "general contractor". Scans every source file under src, without the
// comments, so a string a person could read is caught wherever it lives.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUNCTUATION_DASH, sourceFiles as screenSources, visibleStrings } from './visibleCopyTestUtils.ts'

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
    // ai-copy-4: the job card's button takes its label from here.
    expect(opsSource('screens/ContactDetail/lib/jobNextAction.ts')).not.toMatch(/Mark Complete/)
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

// Every string a person can read (JSX text, words given to label, hint,
// placeholder, title and similar props or fields, words shown straight from
// a JSX expression, and toasts) uses no dash as punctuation: no em dash, no
// en dash, no spaced hyphen, and no lone dash standing in for a value
// (ai-copy-5). Prompts for the AI and code nobody reads are not scanned.
describe('no dash as punctuation in what a person reads', () => {
  // [file under src, the exact string] that may keep its dash. Keep this
  // short, and say on each line why the dash is not punctuation.
  const ALLOWED: [string, string][] = [
  ]
  const allowed = (file: string, text: string) => ALLOWED.some(([f, t]) => f === file && t === text)

  // Parsing every file in src takes a couple of seconds, more on a busy
  // machine, so this test gets more time than the default.
  it('finds none in src', () => {
    const hits = screenSources(srcDir)
      .flatMap((file) => visibleStrings(file))
      .map((s) => ({ ...s, file: s.file.slice(srcDir.length + 1), text: s.text.trim() }))
      .filter((s) => PUNCTUATION_DASH.test(s.text) && !allowed(s.file, s.text))
      .map((s) => `${s.file}:${s.line} ${JSON.stringify(s.text)}`)
    expect(hits).toEqual([])
  }, 60_000)

  it('catches the kinds of string it is meant to catch', () => {
    const sample = [
      "const row = { detail: `Sent ${days}d ago - nudge`, key: 'a - b' }",
      "toastError('Saved - will sync')",
      'export const A = () => <div title="Re-pour">Today \u2014 later {temp ?? \'\u2014\'}',
      '  <Metric value={wind ?? \'\u2013\'} label="Wind" /><b>{n || \'-\'}</b><i className={a - b}>2026-11-17</i></div>'
    ].join('\n')
    const texts = visibleStrings('sample.tsx', sample).filter((s) => PUNCTUATION_DASH.test(s.text)).map((s) => s.text.trim())
    expect(texts).toEqual(['d ago - nudge', 'Saved - will sync', 'Today \u2014 later', '\u2014', '\u2013', '-'])
  })
})

// ai-copy-3: commit 4bc837d swapped each em dash for a comma and kept the
// words, which left run on sentences in hints, empty states, toasts and on
// customer documents. Each pair names a file and a splice it printed. The
// rewrites use two sentences, a colon, or a word that joins the clauses.
describe('no comma splice left where a dash was swapped out', () => {
  const SPLICES: [string, string][] = [
    ['components/BrandLogoPicker.tsx', 'Logo too large, keep it'],
    ['components/BrandLogoPicker.tsx', "Couldn't read image, try"],
    ['components/SignaturePad.tsx', 'Optional, hand the phone'],
    ['components/TimeClockCard.tsx', 'Less than 3 minutes, sure?'],
    ['components/desktop/SnowNotesBuild.tsx', 'Speak or type, AI will'],
    ['components/desktop/SnowNotesBuild.tsx', 'No reports yet, start'],
    ['components/documents/DocumentShell.tsx', "company?.name ? ', ' : ''}Questions?"],
    ['components/documents/ProposalTemplate.tsx', ', itemized below'],
    ['components/documents/ProposalTemplate.tsx', 'Approved, thank you'],
    ['components/documents/ProposalTemplate.tsx', '`, ${nameUnder}`'],
    ['lib/captureActions.ts', 'Note saved, will sync'],
    ['lib/captureActions.ts', 'Task saved, will sync'],
    ['lib/captureActions.ts', "'Saved, will sync'"],
    ['lib/outbox.ts', "storage is full, this didn't save"],
    ['screens/Bid.tsx', '{err}, your scope'],
    ['screens/Activity.tsx', 'approved, ${co.title'],
    ['screens/Activity.tsx', 'added, ${co.title'],
    ['screens/Activity.tsx', '`, ${inv.title}`'],
    ['screens/ContactDetail/sections/composeActivityEvents.ts', 'added, ${co.title'],
    ['screens/Compose.tsx', 'Anything to highlight, price change'],
    ['screens/ContactDetail/lib/jobNextAction.ts', 'done, collect the balance'],
    ['screens/ContactDetail/sections/ChangeOrdersSection.tsx', '${co.sequence_number}, ${co.title}'],
    ['screens/ContactDetail/sections/ChangeOrdersSection.tsx', 'customer, they sign'],
    ['screens/ContactDetail/sections/ChangeOrdersSection.tsx', 'SW corner, replace'],
    ['screens/ContactDetail/sections/Expenses.tsx', 'missing a rate, set rates'],
    ['screens/ContactDetail/sections/Expenses.tsx', 'permits, log as you go'],
    ['screens/ContactDetail/sections/Files.tsx', 'plans, upload anything'],
    ['screens/ContactDetail/sections/Messages.tsx', 'Every touchpoint, call, text, onsite, captured'],
    ['screens/ContactDetail/sections/Selections.tsx', 'needs to pick, tile'],
    ['screens/ContactDetail/sections/Selections.tsx', "': overdue'"],
    ['screens/ContactDetail/sections/Subs.tsx', 'each trade, rates roll'],
    ['screens/Invoices.tsx', 'and retry, your numbers'],
    ['screens/Onboarding.tsx', 'Recommended, seeds'],
    ['screens/Onboarding.tsx', 'Skip, start fresh'],
    ['screens/Partners.tsx', 'sender skipped, share'],
    ['screens/Settings.tsx', 'get started, everything else'],
    ['screens/Settings.tsx', 'One line or several, used'],
    ['screens/Settings.tsx', 'customer documents, proposals'],
    ['screens/Settings.tsx', 'already use, Venmo'],
    ['screens/Settings.tsx', 'touch the money, it goes'],
    ['screens/Settings.tsx', 'under the button, checks'],
    ['screens/Settings.tsx', 'sample data, your own'],
    ['screens/Settings.tsx', 'Off, approvals'],
    ['screens/SubDetail.tsx', 'Lightweight only, never'],
    ['screens/SubDetail.tsx', 'Anything to remember, scheduling'],
    ['screens/Tasks.tsx', "instead, that's your own"],
    ['screens/Team.tsx', 'rate, feeds job labor'],
    ['screens/jobs/JobComplete.tsx', 'saved to Files, share'],
  ]
  for (const [file, text] of SPLICES) {
    it(`${file} no longer says "${text}"`, () => {
      expect(readFileSync(join(srcDir, file), 'utf8')).not.toContain(text)
    })
  }
})
