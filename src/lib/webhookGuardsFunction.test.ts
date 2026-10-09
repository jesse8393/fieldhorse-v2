import { describe, expect, it } from 'vitest'
import { nextEnvelopeStatus } from '../../netlify/functions/docusign-webhook.js'
import { viewedLabelFor } from '../../netlify/functions/public-link.js'

describe('DocuSign envelope status only moves forward', () => {
  it('advances sent to delivered to completed', () => {
    expect(nextEnvelopeStatus('sent', 'delivered')).toBe('delivered')
    expect(nextEnvelopeStatus('delivered', 'completed')).toBe('completed')
    expect(nextEnvelopeStatus(null, 'sent')).toBe('sent')
  })

  it('never regresses a terminal envelope', () => {
    expect(nextEnvelopeStatus('completed', 'sent')).toBeNull()
    expect(nextEnvelopeStatus('completed', 'delivered')).toBeNull()
    expect(nextEnvelopeStatus('declined', 'completed')).toBeNull()
    expect(nextEnvelopeStatus('voided', 'sent')).toBeNull()
  })

  it('ignores unknown and duplicate events instead of writing sent', () => {
    expect(nextEnvelopeStatus('delivered', 'envelope-resent')).toBeNull()
    expect(nextEnvelopeStatus('delivered', '')).toBeNull()
    expect(nextEnvelopeStatus('delivered', 'delivered')).toBeNull()
    expect(nextEnvelopeStatus('delivered', 'sent')).toBeNull()
  })

  it('accepts a decline or void before completion', () => {
    expect(nextEnvelopeStatus('delivered', 'declined')).toBe('declined')
    expect(nextEnvelopeStatus('sent', 'VOIDED')).toBe('voided')
  })
})

describe('customer viewed notifications', () => {
  it('labels change order views as change orders, not proposals', () => {
    expect(viewedLabelFor({ kind: 'change_order', contact_id: 'j1' })).toEqual({ kindLabel: 'change order', detailLink: '/jobs/j1?tab=quote' })
    expect(viewedLabelFor({ kind: 'invoice', contact_id: 'j1' })).toEqual({ kindLabel: 'invoice', detailLink: '/jobs/j1?tab=financials' })
    expect(viewedLabelFor({ kind: 'proposal', contact_id: 'j1' })).toEqual({ kindLabel: 'proposal', detailLink: '/quotes/j1?tab=quote' })
  })
})
