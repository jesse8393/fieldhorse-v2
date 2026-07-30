import { describe, it, expect } from 'vitest'
import { dateInputToTimestamp, timestampToDateInput, dueStatus } from './dueDate.ts'

// Build a year month day string for a date N days from local "today".
function localDateStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('dateInputToTimestamp', () => {
  it('returns null for empty/invalid input', () => {
    expect(dateInputToTimestamp('')).toBeNull()
    expect(dateInputToTimestamp(null)).toBeNull()
    expect(dateInputToTimestamp('not-a-date')).toBeNull()
    expect(dateInputToTimestamp('2026-13')).toBeNull()
  })

  it('round-trips a date through end-of-day without slipping a day', () => {
    const input = localDateStr(0)
    const iso = dateInputToTimestamp(input)
    expect(iso).not.toBeNull()
    expect(timestampToDateInput(iso)).toBe(input)
  })
})

describe('timestampToDateInput', () => {
  it('returns empty string for null/invalid iso', () => {
    expect(timestampToDateInput(null)).toBe('')
    expect(timestampToDateInput('garbage')).toBe('')
  })
})

describe('dueStatus', () => {
  it('returns null when there is no due date', () => {
    expect(dueStatus(null)).toBeNull()
    expect(dueStatus(undefined)).toBeNull()
  })

  it('flags a past day as overdue', () => {
    const status = dueStatus(dateInputToTimestamp(localDateStr(-1)))
    expect(status?.tone).toBe('danger')
    expect(status?.label).toBe('Overdue')
  })

  it('flags today (even at end-of-day) as today, not overdue', () => {
    const status = dueStatus(dateInputToTimestamp(localDateStr(0)))
    expect(status?.tone).toBe('warn')
    expect(status?.label).toBe('Today')
  })

  it('renders a future day as a muted date label', () => {
    const status = dueStatus(dateInputToTimestamp(localDateStr(5)))
    expect(status?.tone).toBe('muted')
    expect(status?.label).not.toBe('Overdue')
    expect(status?.label).not.toBe('Today')
  })
})
