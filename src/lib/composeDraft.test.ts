import { describe, expect, it } from 'vitest'
import { emailDraft } from './composeDraft.ts'

describe('email preview and delivery parity', () => {
  it('extracts a generated subject and preserves the complete body', () => {
    expect(emailDraft('**Subject: Gate access**\n\nPlease open the **west gate**.\nWe arrive at 8:30.', 'Kitchen')).toEqual({ subject: 'Gate access', body: 'Please open the west gate.\nWe arrive at 8:30.' })
  })
  it('uses the same fallback without removing a subject mentioned inside the message', () => {
    expect(emailDraft('Hello\nSubject: a line quoted from your email', 'Kitchen')).toEqual({ subject: 'Kitchen', body: 'Hello\nSubject: a line quoted from your email' })
  })
  it('identifies an empty body rather than sending a subject as message text', () => {
    expect(emailDraft('Subject: Arrival', 'Kitchen')).toEqual({ subject: 'Arrival', body: '' })
  })
})
