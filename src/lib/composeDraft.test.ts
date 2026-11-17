import { describe, expect, it } from 'vitest'
import { emailDraft, plainDraft } from './composeDraft.ts'

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

// ai-copy-2: a drafted message goes to a customer, and a dash used as
// punctuation is the plainest sign a machine wrote it. The prompt asks for
// none; these are the ones the model writes anyway.
describe('a drafted message uses plain punctuation', () => {
  it('turns a dash between words into a comma', () => {
    expect(plainDraft('Hi Jeff \u2014 quick heads up: the slab pour is set for Friday at 7 am. We will need the driveway clear \u2014 thanks.'))
      .toBe('Hi Jeff, quick heads up: the slab pour is set for Friday at 7 am. We will need the driveway clear, thanks.')
    expect(plainDraft('The pour\u2014weather permitting\u2014is Friday.')).toBe('The pour, weather permitting, is Friday.')
    expect(plainDraft('Crew arrives early \u2013 please move the truck.')).toBe('Crew arrives early, please move the truck.')
    expect(plainDraft('Crew arrives early - please move the truck.')).toBe('Crew arrives early, please move the truck.')
  })

  it('reads a range between numbers as to', () => {
    expect(plainDraft('We arrive 7\u20139 am. Expect $500 - $700 for the extra pad.')).toBe('We arrive 7 to 9 am. Expect $500 to $700 for the extra pad.')
  })

  it('drops a dash that ends a line or follows other punctuation', () => {
    expect(plainDraft('See you Friday \u2014\nParker Construction')).toBe('See you Friday\nParker Construction')
    expect(plainDraft('Thanks, \u2014 Jesse')).toBe('Thanks, Jesse')
  })

  it('keeps hyphens inside words, dates and list markers', () => {
    const text = 'Re-pour on 2026-11-20 at 7:30.\n- Bring the 2-inch hose\n- Call 555-0100 on arrival'
    expect(plainDraft(text)).toBe(text)
  })

  it('cleans the subject and body of an email the same way', () => {
    expect(emailDraft('Subject: Slab pour \u2014 Friday\n\nHi Jeff \u2014 see you then.', 'Kitchen')).toEqual({ subject: 'Slab pour, Friday', body: 'Hi Jeff, see you then.' })
  })
})
