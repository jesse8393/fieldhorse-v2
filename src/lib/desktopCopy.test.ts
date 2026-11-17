// D25: words people see on the desktop screens use sentence case, say
// what is true, and use no dash as punctuation. Each pair names a file
// and a string that must not appear in it any more.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const BANNED: [string, string][] = [
  ['src/components/desktop/SnowClientsBuild.tsx', 'New Client'],
  ['src/components/desktop/SnowSubsBuild.tsx', 'Add Vendor'],
  ['src/screens/ContactDetail/sections/Photos.tsx', 'Add Photos'],
  ['src/screens/Bid.tsx', 'Generate Estimate'],
  ['src/components/desktop/SnowNotesBuild.tsx', 'AI Parse'],
  ['src/screens/inbox/Inbox.tsx', 'Open Settings'],
  ['src/lib/jobTypes.ts', "label: 'Outdoor Living'"],
  ['src/components/CommandPalette.tsx', 'templates, billing'],
  ['src/components/CommandPalette.tsx', 'Morning revenue brief'],
  ['src/screens/SubPortal.tsx', 'main sidebar'],
  ['src/screens/Importer.tsx', ': not mapped :'],
  ['src/screens/Tasks.tsx', "error ? '—'"],
  ['src/screens/Importer.tsx', '{m.amount || 0}'],
  // ai-copy-4: buttons and labels in sentence case.
  ['src/screens/NotFound.tsx', 'Back to Home'],
  ['src/components/RouteErrorBoundary.tsx', 'Go Home'],
  ['src/screens/Notes.tsx', "'Save Note'"],
  ['src/screens/ContactDetail/sections/Files.tsx', "'Add Files'"],
  ['src/screens/ContactDetail/tabs/Overview.tsx', 'label="Job Progress"'],
  ['src/screens/SubDetail.tsx', 'Sub Directory'],
]

describe('desktop copy (D25)', () => {
  for (const [file, text] of BANNED) {
    it(`${file} no longer says "${text}"`, () => {
      expect(readFileSync(file, 'utf8')).not.toContain(text)
    })
  }
})
