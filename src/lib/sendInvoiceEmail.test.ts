import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// sendInvoiceEmail marks the invoice sent once its email is out. The row
// it holds was read when the send started, and the email can take seconds
// on a weak signal. A void or a payment recorded in those seconds must
// stay: the invoice must not read as sent again once the email lands
// (review of Phase 8, task 6).

type InvoiceRecord = { id: string; status: string; issued_at: string | null; [column: string]: unknown }

// The invoices as the database holds them right now.
let stored: InvoiceRecord[] = []
// Runs while the email is going out, between the send starting and landing.
let whileSending: () => void = () => {}

// A fake of the PostgREST chains sendInvoiceEmail uses. An update changes
// only the rows that pass every filter on it, as the database would.
function updateChain(table: string, values: Record<string, unknown>) {
  const tests: ((row: InvoiceRecord) => boolean)[] = []
  const listed = (text: string) => text.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
  const chain = {
    eq: (column: string, value: unknown) => { tests.push((row) => row[column] === value); return chain },
    neq: (column: string, value: unknown) => { tests.push((row) => row[column] != null && row[column] !== value); return chain },
    in: (column: string, list: unknown[]) => { tests.push((row) => list.includes(row[column])); return chain },
    not: (column: string, op: string, value: unknown) => {
      if (op === 'in') tests.push((row) => row[column] != null && !listed(String(value)).includes(String(row[column])))
      else if (op === 'eq') tests.push((row) => row[column] != null && row[column] !== value)
      else if (op === 'is') tests.push((row) => row[column] != null)
      else throw new Error(`The fake has no not.${op}`)
      return chain
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (table === 'fh_invoices') {
        for (const row of stored.filter((r) => tests.every((test) => test(r)))) Object.assign(row, values)
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    }
  }
  return chain
}

vi.mock('./supabase.ts', () => ({
  supabase: {
    storage: { from: () => ({ upload: async () => ({ data: { path: 'p' }, error: null }) }) },
    from: (table: string) => ({
      insert: async () => ({ data: null, error: null }),
      update: (values: Record<string, unknown>) => updateChain(table, values)
    })
  },
  authHeaders: async () => ({})
}))

const { sendInvoiceEmail } = await import('./invoices.ts')

const company = { name: 'Harlow Construction Co.', address: '100 Main St', phone: '', email: 'admin@example.com' }
const contact = { id: '6f1c9b1e-0000-4000-8000-000000000001', name: 'Rosa Delgado', amount: 8000, job_title: 'Concrete steps', email: 'rosa@example.com' }

function invoiceRow(status: string, issuedAt: string | null) {
  return {
    id: 'i-rosa', contact_id: contact.id, user_id: 'u-1', title: 'Final', amount: 1240, status,
    sequence_number: 2, due_at: '2026-10-02', issued_at: issuedAt, notes: null, description: null,
    created_at: '2026-09-28T12:00:00Z', updated_at: '2026-09-28T12:00:00Z', org_id: 'org-1'
  } as any
}

// Sends the invoice as the screen read it, with the database row starting
// out the same, beside another draft of the job that must stay as it is.
async function send(status: string, issuedAt: string | null) {
  const snapshot = invoiceRow(status, issuedAt)
  stored = [{ ...snapshot }, { ...invoiceRow('draft', null), id: 'i-other', sequence_number: 3 }]
  const result = await sendInvoiceEmail({ invoice: snapshot, contact, company, userId: 'u-1', recipientEmail: 'rosa@example.com' })
  expect(result.ok).toBe(true)
  expect(stored[1].status).toBe('draft')
  expect(stored[1].issued_at).toBeNull()
  return stored[0]
}

beforeEach(() => {
  whileSending = () => {}
  vi.stubGlobal('fetch', vi.fn(async () => {
    whileSending()
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendInvoiceEmail marks the invoice sent', () => {
  it('marks a draft sent, with today as its issue date, once the email is out', async () => {
    const row = await send('draft', null)
    expect(row.status).toBe('sent')
    expect(row.issued_at).toBeTruthy()
  })

  it('keeps a sent invoice sent and its first issue date', async () => {
    const row = await send('sent', '2026-09-28T12:00:00Z')
    expect(row.status).toBe('sent')
    expect(row.issued_at).toBe('2026-09-28T12:00:00Z')
  })

  it('keeps a void recorded while the email was going out', async () => {
    whileSending = () => { stored[0].status = 'void' }
    const row = await send('sent', '2026-09-28T12:00:00Z')
    expect(row.status).toBe('void')
    expect(row.issued_at).toBe('2026-09-28T12:00:00Z')
  })

  it('keeps a payment recorded while the email was going out', async () => {
    whileSending = () => { stored[0].status = 'paid' }
    const row = await send('sent', '2026-09-28T12:00:00Z')
    expect(row.status).toBe('paid')
  })

  it('keeps a draft voided while its first email was going out void, with no issue date', async () => {
    whileSending = () => { stored[0].status = 'void' }
    const row = await send('draft', null)
    expect(row.status).toBe('void')
    expect(row.issued_at).toBeNull()
  })

  it('never marks a paid invoice sent again', async () => {
    const row = await send('paid', '2026-09-28T12:00:00Z')
    expect(row.status).toBe('paid')
  })
})

describe('sendInvoiceEmail tells the email what the invoice is for', () => {
  it("posts the invoice's own description, else the job title", async () => {
    stored = [{ ...invoiceRow('draft', null) }]
    const posted = () => JSON.parse(String((vi.mocked(fetch).mock.calls.at(-1) as any)[1].body))
    await sendInvoiceEmail({ invoice: { ...invoiceRow('draft', null), description: ' Deposit for the shed slab ' }, contact, company, userId: 'u-1', recipientEmail: 'rosa@example.com' })
    expect(posted().description).toBe('Deposit for the shed slab')
    await sendInvoiceEmail({ invoice: invoiceRow('draft', null), contact, company, userId: 'u-1', recipientEmail: 'rosa@example.com' })
    expect(posted().description).toBe('Concrete steps')
  })
})
