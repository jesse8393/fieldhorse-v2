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
    expect(plainDraft('Pour set for Nov 3\u20135. Budget $4,500\u2013$5,000.')).toBe('Pour set for Nov 3 to 5. Budget $4,500 to $5,000.')
  })

  // A range of days, months or clock times must stay a range. Read as a list
  // it would tell the customer something else.
  it('reads a range of days, months and times as to', () => {
    expect(plainDraft('We will be on site Monday\u2013Friday.')).toBe('We will be on site Monday to Friday.')
    expect(plainDraft('Crew hours 7am\u20133pm.')).toBe('Crew hours 7am to 3pm.')
    expect(plainDraft('Crew hours 7 am \u2013 3 pm.')).toBe('Crew hours 7 am to 3 pm.')
    expect(plainDraft('Crew hours 7 a.m. \u2014 3 p.m.')).toBe('Crew hours 7 a.m. to 3 p.m.')
    expect(plainDraft('The job runs March\u2013April.')).toBe('The job runs March to April.')
    expect(plainDraft('Open Mon - Fri.')).toBe('Open Mon to Fri.')
    expect(plainDraft('Open Tues \u2014 Sat, closed Sunday.')).toBe('Open Tues to Sat, closed Sunday.')
  })

  it('still reads a dash between other words as a pause', () => {
    expect(plainDraft('Hi Jeff \u2013 quick note about Friday.')).toBe('Hi Jeff, quick note about Friday.')
    expect(plainDraft('See you Friday \u2014 the crew will call ahead.')).toBe('See you Friday, the crew will call ahead.')
    expect(plainDraft('We may \u2014 if it rains \u2014 move the pour.')).toBe('We may, if it rains, move the pour.')
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
