// Copy rules for the native app: the same plain wording the web app keeps.
// Sentence case, no dash used as punctuation, no emoji, and no comma splice
// where a dash was once swapped for a comma (ai-copy-9).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PUNCTUATION_DASH, sourceFiles, visibleStrings } from '../../src/lib/visibleCopyTestUtils.ts'

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(join(MOBILE, path), 'utf8')

// Every string a person reads in the app's screens and components.
const shown = ['app', 'components']
  .flatMap((dir) => sourceFiles(join(MOBILE, dir)))
  .flatMap((file) => visibleStrings(file))
  .map((s) => ({ ...s, file: s.file.slice(MOBILE.length + 1), text: s.text.trim() }))

describe('native app copy', () => {
  // ai-copy-2: a drafted customer message must not read as machine written.
  it('asks the drafting model for plain punctuation', () => {
    expect(read('app/compose.tsx')).toMatch(/no em dashes, no en dashes, no hyphens used as dashes/)
  })

  it('reads the screens it is meant to read', () => {
    expect(shown.some((s) => s.file === 'app/settings.tsx')).toBe(true)
    expect(shown.length).toBeGreaterThan(300)
  })

  it('uses no dash as punctuation in what a person reads', () => {
    const hits = shown.filter((s) => PUNCTUATION_DASH.test(s.text)).map((s) => `${s.file}:${s.line} ${JSON.stringify(s.text)}`)
    expect(hits).toEqual([])
  })

  it('uses no emoji in what a person reads', () => {
    const hits = shown.filter((s) => /\p{Extended_Pictographic}/u.test(s.text)).map((s) => `${s.file}:${s.line} ${JSON.stringify(s.text)}`)
    expect(hits).toEqual([])
  })

  // Each pair names a file and a string that must not appear in it.
  const BANNED: [string, string][] = [
    // Title Case menu items, buttons, labels and links.
    ['app/(tabs)/index.tsx', 'Total Pipeline'],
    ['app/(tabs)/index.tsx', 'label="AI Compose"'],
    ['app/(tabs)/more.tsx', 'title="Dispatch AI"'],
    ['app/(tabs)/more.tsx', 'Invoices & Payments'],
    ['app/(tabs)/more.tsx', 'Pour Window'],
    ['app/invoices/[id].tsx', 'Collect Payment'],
    ['app/invoices/index.tsx', 'Mark Paid'],
    ['app/settings.tsx', 'Pour Window'],
    ['app/settings.tsx', 'Privacy Policy'],
    ['app/settings.tsx', 'Terms of Service'],
    ['app/settings.tsx', "'Saved \u2713'"],
    ['app/bid.tsx', '\u2013'],
    ['app/subs/index.tsx', 'Sub Directory'],
    ['app/notes.tsx', 'eyebrow="Field Notes"'],
    ['lib/proposalHtml.ts', 'Unit Price'],
    ['lib/proposalHtml.ts', 'Est. Total'],
    // Pitch lines that read as generated.
    ['app/(tabs)/more.tsx', 'Scope to line item bid in seconds'],
    ['app/(tabs)/index.tsx', "Today's revenue opportunity"],
    ['app/notes.tsx', 'Notes, fast.'],
    // Comma splices left where a dash was swapped for a comma.
    ['app/(tabs)/schedule.tsx', 'A clear stretch, nothing'],
    ['app/compose.tsx', 'to mention, dates'],
    ['app/estimates.tsx', "send it, it'll track"],
    ['app/integrations.tsx', '${p.name}, setup pending'],
    ['app/integrations.tsx', 'on the server, your tokens'],
    ['app/invoices/[id].tsx', 'text or email, the customer'],
    ['app/invoices/index.tsx', 'Nothing outstanding, all caught up'],
    ['app/jobs/[id].tsx', 'payment terms, they flow'],
    ['app/jobs/[id].tsx', 'carrier claim, surfaces'],
    ['app/jobs/[id].tsx', 'No clients yet, create'],
    ['app/onboarding.tsx', 'you run, this configures'],
    ['app/onboarding.tsx', 'Optional, powers'],
    ['app/onboarding.tsx', 'unavailable, tap to retry'],
    ['app/quote/[id].tsx', 'text or email, the customer'],
    ['app/subs/index.tsx', "Subs section, they show up"],
  ]
  for (const [file, text] of BANNED) {
    it(`${file} no longer says "${text}"`, () => {
      expect(read(file)).not.toContain(text)
    })
  }
})
