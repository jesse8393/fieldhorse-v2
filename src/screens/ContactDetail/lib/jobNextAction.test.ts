import { describe, it, expect } from 'vitest'
import { resolveNextAction, resolvePrimaryAction } from './jobNextAction.ts'

const future = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString()
const past = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
const dayISO = (offsetDays: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

describe('resolveNextAction priority chain', () => {
  it('returns idle with no contact', () => {
    expect(resolveNextAction({}).kind).toBe('idle')
  })

  it('an upcoming schedule entry beats milestones and todos', () => {
    const r = resolveNextAction({
      contact: { stage: 'job', milestones: [{ label: 'Frame', done: false }] },
      scheduleItems: [{ id: 's1', title: 'Site visit', start_at: future(120) }],
      todos: [{ id: 't1', text: 'Call supplier' }]
    })
    expect(r.kind).toBe('schedule')
    expect(r.sourceId).toBe('s1')
  })

  it('ignores past schedule entries and picks the soonest future one', () => {
    const r = resolveNextAction({
      contact: { stage: 'job' },
      scheduleItems: [
        { id: 'old', title: 'Yesterday', start_at: past(60) },
        { id: 'soon', title: 'Soon', start_at: future(30) },
        { id: 'later', title: 'Later', start_at: future(300) }
      ]
    })
    expect(r.kind).toBe('schedule')
    expect(r.sourceId).toBe('soon')
  })

  it('falls to the first undone milestone when no upcoming schedule', () => {
    const r = resolveNextAction({
      contact: { stage: 'job', milestones: [{ label: 'Permit', done: true }, { label: 'Frame', done: false }] },
      todos: [{ id: 't1', text: 'Call supplier' }]
    })
    expect(r.kind).toBe('milestone')
    expect(r.title).toBe('Frame')
    expect(r.sourceId).toBe(1)
  })

  it('falls to todos when no schedule or milestones', () => {
    const r = resolveNextAction({
      contact: { stage: 'job' },
      todos: [{ id: 't1', text: 'Call supplier' }]
    })
    expect(r.kind).toBe('todo')
    expect(r.sourceId).toBe('t1')
  })

  it('ranks overdue todos above future and undated', () => {
    const r = resolveNextAction({
      contact: { stage: 'job' },
      todos: [
        { id: 'undated', text: 'Someday' },
        { id: 'future', text: 'Next week', due_at: dayISO(7) },
        { id: 'overdue', text: 'Was due', due_at: dayISO(-2) }
      ]
    })
    expect(r.sourceId).toBe('overdue')
  })

  it('uses the stage default when nothing is actionable', () => {
    const r = resolveNextAction({ contact: { stage: 'quote' } })
    expect(r.kind).toBe('stage')
    expect(r.ctaLabel).toBe('Approve quote')
    expect(r.pipelineFn).toBe('approveQuote')
  })

  it('falls back to the lead default for an unknown stage', () => {
    const r = resolveNextAction({ contact: { stage: 'banana' } })
    expect(r.kind).toBe('stage')
    expect(r.pipelineFn).toBe('startQuote')
  })
})

describe('resolvePrimaryAction pipeline priority', () => {
  it('keeps lead progression primary even when tasks exist', () => {
    const r = resolvePrimaryAction({
      contact: { stage: 'lead', milestones: [{ label: 'Call back', done: false }] },
      scheduleItems: [{ id: 's1', title: 'Site walk', start_at: future(120) }],
      todos: [{ id: 't1', text: 'Measure' }]
    })
    expect(r.kind).toBe('stage')
    expect(r.ctaLabel).toBe('Convert to quote')
    expect(r.pipelineFn).toBe('startQuote')
  })

  it('keeps quote approval primary even when todos exist', () => {
    const r = resolvePrimaryAction({
      contact: { stage: 'quote' },
      todos: [{ id: 't1', text: 'Follow up' }]
    })
    expect(r.kind).toBe('stage')
    expect(r.pipelineFn).toBe('approveQuote')
  })

  it('reviews customer changes before quote approval', () => {
    const r = resolvePrimaryAction({
      contact: { stage: 'quote', proposal_status: 'changes_requested' },
      todos: [{ id: 't1', text: 'Follow up' }]
    })
    expect(r.kind).toBe('stage')
    expect(r.ctaLabel).toBe('Review changes')
    expect(r.pipelineFn).toBe('reviewQuoteChanges')
  })

  it('keeps active job delivery work primary until the job is complete', () => {
    const r = resolvePrimaryAction({
      contact: { stage: 'job' },
      scheduleItems: [{ id: 's1', title: 'Pour', start_at: future(120) }]
    })
    expect(r.kind).toBe('schedule')
    expect(r.sourceId).toBe('s1')
  })

  it('moves a completed job to invoicing even if todos remain', () => {
    const r = resolvePrimaryAction({
      contact: { stage: 'job', completed_at: new Date().toISOString() },
      todos: [{ id: 't1', text: 'Archive photos' }]
    })
    expect(r.kind).toBe('stage')
    expect(r.pipelineFn).toBe('sendInvoice')
  })
})
