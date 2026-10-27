import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase.ts', () => ({ supabase: {} }))
import { DocumentPreviewPane } from '../../screens/ContactDetail/sections/DocumentPreviewPane.tsx'
import { generateQuote } from '../../lib/pdf.js'

const items = [
  { id: 'a', description: 'Concrete', notes: 'Grind the north landing.\nProtect the entry doors.', section: 'Concrete', qty: 1, rate: 1300, amount: 1300 },
  { id: 'b', description: 'Steps', notes: 'Replace all six treads.', section: 'Carpentry', qty: 1, rate: 6450, amount: 6450 },
  { id: 'c', description: 'Optional coating', notes: 'Use charcoal finish.', qty: 1, rate: 300, amount: 300, is_optional: true },
  { id: 'd', description: 'Railing', notes: 'Existing rails remain.', qty: 1, amount: 500, is_excluded: true }
]
const contact = { id: 'quote-1', name: 'Example Customer', job_title: 'Entry repairs', created_at: '2026-10-01', proposal_status: 'sent', exclusions_text: 'Permit fees are not included.' }
const company = { name: 'Example Construction', phone: '615 555 0100', email: 'office@exampleconstructioncompany.com' }
const themes = ['classic', 'mint', 'slate', 'editorial', 'fieldhorse']

describe('complete customer proposal scope', () => {
  for (const template of themes) {
    it(`${template} keeps base and optional line notes in the customer preview`, () => {
      const html = renderToStaticMarkup(<DocumentPreviewPane bare company={{ ...company, estimate_template: template }} contact={contact} items={items} loading={false} payments={[]} />)
      for (const detail of ['Grind the north landing.', 'Protect the entry doors.', 'Replace all six treads.', 'Use charcoal finish.']) expect(html).toContain(detail)
      expect(html).toContain('$7,750.00')
      if (template !== 'fieldhorse') {
        expect(html).toContain('Existing rails remain.')
        expect(html).toContain('Permit fees are not included.')
      }
    })
    it(`${template} retains scope notes in the exported PDF`, async () => {
      const result = await generateQuote({ company: { ...company, estimate_template: template }, contact, quoteId: contact.id, items, exclusions: contact.exclusions_text } as any)
      const doc = result.doc as any
      const text = doc.internal.pages.flatMap((page: string[] | undefined) => (page || []).flatMap((op: string) => [...op.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1]))).join(' ')
      for (const detail of ['Grind the north landing.', 'Protect the entry doors.', 'Replace all six treads.', 'Use charcoal finish.', 'Existing rails remain.']) expect(text).toContain(detail)
      expect(text).toContain('$7,750.00')
    })
  }
})
