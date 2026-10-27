import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase.ts', () => ({ supabase: {} }))
import { communicationStatus, mergeCommunicationHistory, normalizeCommunicationMessages, normalizeCommunicationNotes } from './communicationHistory.ts'

describe('communication history truthfulness', () => {
  it('keeps confirmed external sending separate from provider delivery', () => {
    expect(communicationStatus('reported_sent', 'log')).toBe('Reported sent')
    expect(communicationStatus('sent', 'message')).toBe('Sent')
    expect(communicationStatus('delivered', 'message')).toBe('Delivered')
    expect(communicationStatus('queued', 'message')).toBe('Not sent yet')
    expect(communicationStatus('failed', 'message')).toBe('Not delivered')
  })

  it('preserves actual content and ignores unrelated activity', () => {
    const entries = normalizeCommunicationNotes([
      { id: 'a', category: 'activity', text: 'Invoice updated' },
      { id: 'b', category: 'email', contact_id: 'job-1', created_at: '2026-10-01T15:00:00Z', parsed: { communication: { version: 1, status: 'sent', channel: 'email', subject: 'Arrival', body: 'West gate\n8:30 AM', to: 'customer@example.com' } } },
      { id: 'c', category: 'activity', text: 'Message sent to old@example.com' },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ title: 'Arrival', body: 'West gate\n8:30 AM', status: 'Sent', contactId: 'job-1' })
    expect(entries[1]).toMatchObject({ status: 'Logged activity', body: 'Message sent to old@example.com' })
  })

  it('does not invent content or delivery for old logs and future formats', () => {
    expect(normalizeCommunicationNotes([{ id: 'a', category: 'text', text: 'Called before site visit', parsed: { communication: { version: 2, status: 'delivered' } } }])[0])
      .toMatchObject({ body: 'Called before site visit', status: 'Logged activity' })
  })

  it('retains inbound replies, failures and conversation destinations', () => {
    const entries = normalizeCommunicationMessages([
      { id: 'one', direction: 'inbound', body: 'Confirmed', conversation_id: 'thread', status: 'received', channel: 'sms' },
      { id: 'two', direction: 'outbound', body: 'Unsent', status: 'held', channel: 'email' },
    ])
    expect(entries[0]).toMatchObject({ status: 'Received', conversationId: 'thread', body: 'Confirmed' })
    expect(entries[1].status).toBe('Held for review')
  })

  it('orders combined sources and deduplicates repeated pagination rows', () => {
    const notes = normalizeCommunicationNotes([{ id: 'one', category: 'call', created_at: '2026-10-01T10:00:00Z' }])
    const messages = normalizeCommunicationMessages([{ id: 'two', created_at: '2026-10-02T10:00:00Z' }])
    expect(mergeCommunicationHistory([...notes, ...notes], messages).map((entry) => entry.id)).toEqual(['message:two', 'note:one'])
  })
})
