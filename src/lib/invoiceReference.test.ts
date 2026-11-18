// formats-1: the app names an invoice by the number the PDF and the
// customer link print (PCC-2D3E-01), so a customer who calls about that
// number can be found.
import { describe, expect, it } from 'vitest'
import { invoiceReference } from './invoiceReference.ts'
import { invoiceNumberFromSequence } from '../components/documents/numbers.ts'

const JOB = '1c8d2e3f-4051-4b6c-9d7e-8f9a0b1c2d3e'

describe('invoiceReference', () => {
  it('is the document number the PDF and the customer link print', () => {
    const inv = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', sequence_number: 1, contact_id: JOB, client_id: 'cl-h' }
    expect(invoiceReference(inv, 'Parker Construction Company')).toBe('PCC-2D3E-01')
    expect(invoiceReference(inv, 'Parker Construction Company')).toBe(invoiceNumberFromSequence('Parker Construction Company', 1, JOB))
  })

  it('numbers an invoice billed to the client from the client, as the PDF does', () => {
    const inv = { id: 'inv-d', sequence_number: 2, contact_id: null, client_id: 'client-0009' }
    expect(invoiceReference(inv, 'Parker Concrete & Construction')).toBe('PCC-0009-02')
  })

  it('keeps a stored document number', () => {
    expect(invoiceReference({ id: 'x', sequence_number: 3, doc_number: ' A-100 ', contact_id: JOB }, 'Parker Construction Company')).toBe('A-100')
  })

  // Two invoices on one job with no sequence yet still read apart, so a
  // duplicate check can tell them from each other.
  it('tells two unsequenced invoices on one job apart', () => {
    const a = invoiceReference({ id: 'aaaaaaaa-0001', contact_id: JOB, issued_at: '2026-11-10T12:00:00Z' }, 'Parker Construction Company')
    const b = invoiceReference({ id: 'bbbbbbbb-0002', contact_id: JOB, issued_at: '2026-11-10T12:00:00Z' }, 'Parker Construction Company')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^PCC-/)
  })
})
