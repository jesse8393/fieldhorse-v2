// ai-copy-2: the native compose screen cleans a drafted message the same way
// the web does, so a dash the model writes anyway never reaches a customer.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plainPunctuation } from './composeDraft'

const compose = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'compose.tsx'), 'utf8')

describe('a native drafted message uses plain punctuation', () => {
  it('turns a dash into plain punctuation and keeps a range a range', () => {
    expect(plainPunctuation('Hi Jeff — see you Friday')).toBe('Hi Jeff, see you Friday')
    expect(plainPunctuation('On site Monday–Friday, 7 am – 3 pm.')).toBe('On site Monday to Friday, 7 am to 3 pm.')
  })

  it('cleans the draft as soon as it arrives', () => {
    expect(compose).toMatch(/setDraft\(plainPunctuation\(text\)\)/)
  })
})
