// Copy rules for the native app: the same plain wording the web app keeps.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(join(MOBILE, path), 'utf8')

describe('native app copy', () => {
  // ai-copy-2: a drafted customer message must not read as machine written.
  it('asks the drafting model for plain punctuation', () => {
    expect(read('app/compose.tsx')).toMatch(/no em dashes, no en dashes, no hyphens used as dashes/)
  })
})
