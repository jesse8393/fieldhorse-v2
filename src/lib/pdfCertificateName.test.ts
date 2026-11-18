// formats-14: the completion certificate's file name carries the day the
// job closed in the company's own time, the day the app shows, never the
// UTC day, which is already tomorrow after 6 pm Central.
import { afterAll, describe, expect, it, vi } from 'vitest'

const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

vi.mock('./pdfLogo.ts', () => ({ loadLogoForPdf: async () => null, loadImageForPdf: async () => null }))
const { generateCertificate } = await import('./pdf.js')

describe('the certificate file name', () => {
  it('uses the local day a job closed in the evening', async () => {
    // Mon Nov 16, 7:30 pm Central, which is Nov 17 in UTC.
    const r: any = await generateCertificate({
      company: { company_name: 'Parker Construction' },
      contact: { id: 'j', name: 'Harold Wickham', job_title: 'Driveway' },
      closeout: { closed_at: '2026-11-17T01:30:00Z', warranty_months: 12, warranty_start_date: '2026-11-16' }
    } as any)
    expect(r.filename).toBe('Certificate-Harold-Wickham-2026-11-16.pdf')
  })
})
