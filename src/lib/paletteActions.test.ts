import { describe, expect, it } from 'vitest'
import { actionForShortcut, paletteActions, shortcutModifier, type PaletteJob } from './paletteActions.ts'
import { navigateHref } from './todayView.ts'

const JOB: PaletteJob = {
  id: 'c-job1',
  name: 'Plumbing Bellevue',
  job_title: 'Slab + trench',
  address: '412 Burkitt Station Rd',
  stage: 'job',
  phone: '555-0101'
}

describe('paletteActions', () => {
  it('lists the four job actions in order with their labels and keys', () => {
    const actions = paletteActions(JOB, true)
    expect(actions.map((a) => a.id)).toEqual(['invoice', 'message', 'note', 'navigate'])
    expect(actions.map((a) => a.label)).toEqual([
      'Create invoice for Slab + trench',
      'Message Plumbing Bellevue',
      'Add a note to Slab + trench',
      'Navigate to 412 Burkitt Station Rd'
    ])
    expect(actions.map((a) => a.key)).toEqual(['I', 'M', 'N', null])
  })

  it('returns nothing when no job is highlighted', () => {
    expect(paletteActions(null, true)).toEqual([])
  })

  it('uses the job name where a job has no title', () => {
    for (const job_title of [null, '', '   ']) {
      const actions = paletteActions({ ...JOB, job_title }, true)
      expect(actions.find((a) => a.id === 'invoice')?.label).toBe('Create invoice for Plumbing Bellevue')
      expect(actions.find((a) => a.id === 'note')?.label).toBe('Add a note to Plumbing Bellevue')
      expect(actions.find((a) => a.id === 'message')?.label).toBe('Message Plumbing Bellevue')
    }
  })

  it('hides the invoice action from roles that cannot move money', () => {
    const actions = paletteActions(JOB, false)
    expect(actions.map((a) => a.id)).toEqual(['message', 'note', 'navigate'])
    expect(actions.some((a) => a.key === 'I')).toBe(false)
  })

  it('offers the invoice action only on job and invoice stages', () => {
    const has = (stage: string) => paletteActions({ ...JOB, stage }, true).some((a) => a.id === 'invoice')
    expect(has('job')).toBe(true)
    expect(has('invoice')).toBe(true)
    for (const stage of ['lead', 'quote', 'closed', 'lost']) expect(has(stage)).toBe(false)
  })

  it('leaves out Navigate when the job has no address', () => {
    for (const address of [null, '', '   ']) {
      const actions = paletteActions({ ...JOB, address }, true)
      expect(actions.map((a) => a.id)).toEqual(['invoice', 'message', 'note'])
    }
  })

  it('sends each action where the app already handles it', () => {
    const actions = paletteActions(JOB, true)
    const by = Object.fromEntries(actions.map((a) => [a.id, a]))
    expect(by.invoice.to).toBe('/jobs/c-job1?action=send_invoice')
    expect(by.message.to).toBe('sms:555-0101')
    expect(by.note.event).toBe('fh:open-capture')
    expect(by.note.to).toBeUndefined()
    expect(by.navigate.to).toBe(navigateHref('412 Burkitt Station Rd'))
  })

  it('opens the job when there is no phone number to message', () => {
    const actions = paletteActions({ ...JOB, phone: null }, true)
    expect(actions.find((a) => a.id === 'message')?.to).toBe('/jobs/c-job1')
  })

  it('picks Apple Maps on an iPhone', () => {
    const actions = paletteActions(JOB, true, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })
    expect(actions.find((a) => a.id === 'navigate')?.to).toContain('maps.apple.com')
  })
})

describe('actionForShortcut', () => {
  const actions = paletteActions(JOB, true)
  const press = (code: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    actionForShortcut(actions, { code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods })

  it('runs an action on Alt plus its letter', () => {
    expect(press('KeyI', { altKey: true })?.id).toBe('invoice')
    expect(press('KeyM', { altKey: true })?.id).toBe('message')
    expect(press('KeyN', { altKey: true })?.id).toBe('note')
  })

  it('never takes a plain letter, so typing in the search field is safe', () => {
    for (const code of ['KeyI', 'KeyM', 'KeyN']) expect(press(code)).toBeNull()
  })

  it('ignores other modifier mixes and keys without a shortcut', () => {
    expect(press('KeyI', { altKey: true, ctrlKey: true })).toBeNull()
    expect(press('KeyI', { altKey: true, metaKey: true })).toBeNull()
    expect(press('KeyI', { altKey: true, shiftKey: true })).toBeNull()
    expect(press('KeyX', { altKey: true })).toBeNull()
  })

  it('finds nothing for an action the role does not have', () => {
    const crew = paletteActions(JOB, false)
    const hit = actionForShortcut(crew, { code: 'KeyI', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })
    expect(hit).toBeNull()
  })
})

describe('shortcutModifier', () => {
  it('prints Option on a Mac and Alt everywhere else', () => {
    expect(shortcutModifier({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('⌥')
    expect(shortcutModifier({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('Alt')
    expect(shortcutModifier()).toBe('Alt')
  })
})
