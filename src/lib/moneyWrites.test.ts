import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDatabaseTypes } from '../../scripts/lib/schemaRefs.mjs'

// What recording a payment on an invoice and marking a job complete send to
// the database. Neither had a test that sent it: the payment upsert is cast
// to any, so a wrong column or a dropped invoice_id passed every check.
// Each payload is also held against the columns in database.types.ts.

type Call = { table: string; ops: unknown[][] }
const calls: Call[] = []
const results: Record<string, { data: unknown; error: unknown }> = {}

function builder(table: string) {
  const entry: Call = { table, ops: [] }
  calls.push(entry)
  const result = () => results[table] ?? { data: null, error: null }
  const b: any = {}
  for (const m of ['select', 'eq', 'is', 'insert', 'upsert', 'update', 'single', 'maybeSingle']) {
    b[m] = (...args: unknown[]) => { entry.ops.push([m, ...args]); return b }
  }
  b.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject)
  return b
}

vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => builder(table) }, authHeaders: async () => ({}) }))

const { logInvoicePayment } = await import('./invoices.ts')
const { completeJob } = await import('./stages.ts')

const schema = parseDatabaseTypes(fs.readFileSync(new URL('./database.types.ts', import.meta.url), 'utf8'))
const columnsOf = (table: string) => schema.tables[table].columns

function op(table: string, name: string) {
  return calls.filter((c) => c.table === table).map((c) => c.ops.find((o) => o[0] === name)).filter(Boolean) as unknown[][]
}

beforeEach(() => {
  calls.length = 0
  for (const key of Object.keys(results)) delete results[key]
})

const invoice = { id: 'inv-9', user_id: 'owner-1', amount: 2960, status: 'sent' as const }

describe('logInvoicePayment', () => {
  it('upserts one fh_payments row linked to the invoice and to no job, idempotent by id', async () => {
    const res = await logInvoicePayment(invoice, { id: 'pay-1', amount: 1000, method: 'card', kind: 'deposit', reference: 'R-7', paid_on: '2026-11-17' })
    expect(res).toEqual({ error: null, paid: false })
    const [[, payload, options]] = op('fh_payments', 'upsert')
    expect(payload).toEqual({
      id: 'pay-1', user_id: 'owner-1', contact_id: null, invoice_id: 'inv-9', amount: 1000,
      method: 'card', kind: 'deposit', reference: 'R-7', paid_on: '2026-11-17'
    })
    expect(options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    for (const key of Object.keys(payload as object)) expect(columnsOf('fh_payments'), key).toContain(key)
    // Not covered yet, so the invoice keeps its status.
    expect(op('fh_invoices', 'update')).toEqual([])
  })

  it('fills the defaults: check, other, today, and no reference', async () => {
    await logInvoicePayment(invoice, { amount: '50' as unknown as number, kind: 'tip' })
    const [[, payload]] = op('fh_payments', 'upsert')
    expect(payload).toMatchObject({ amount: 50, method: 'check', kind: 'other', reference: null, paid_on: new Date().toISOString().slice(0, 10) })
    expect(payload).not.toHaveProperty('id')
  })

  it('marks the invoice paid once this payment and the earlier ones cover it', async () => {
    const res = await logInvoicePayment(invoice, { id: 'pay-2', amount: 960, priorPayments: [{ amount: 1000 }, { amount: '1000' }] })
    expect(res).toEqual({ error: null, paid: true })
    const updates = calls.filter((c) => c.table === 'fh_invoices')
    expect(updates).toHaveLength(1)
    expect(updates[0].ops).toEqual([['update', { status: 'paid' }], ['eq', 'id', 'inv-9']])
    expect(columnsOf('fh_invoices')).toContain('status')
  })

  it('leaves a paid or void invoice as it is', async () => {
    await logInvoicePayment({ ...invoice, status: 'paid' }, { amount: 2960 })
    await logInvoicePayment({ ...invoice, status: 'void' }, { amount: 2960 })
    expect(op('fh_invoices', 'update')).toEqual([])
  })

  it('returns the database error and does not touch the invoice when the payment is refused', async () => {
    results.fh_payments = { data: null, error: { code: 'PGRST204', message: 'column' } }
    const res = await logInvoicePayment(invoice, { amount: 2960 })
    expect(res).toEqual({ error: { code: 'PGRST204', message: 'column' }, paid: false })
    expect(op('fh_invoices', 'update')).toEqual([])
  })
})

describe('completeJob', () => {
  it('stamps completed_at on that job, scoped to its owner, and returns the row', async () => {
    results.fh_contacts = { data: { id: 'c-job1', completed_at: 'x' }, error: null }
    const before = Date.now()
    const res = await completeJob({ id: 'c-job1', user_id: 'owner-1' } as any)
    expect(res).toEqual({ data: { id: 'c-job1', completed_at: 'x' }, error: null })
    const [call] = calls.filter((c) => c.table === 'fh_contacts')
    const [, patch] = call.ops[0] as [string, { completed_at: string }]
    expect(call.ops[0][0]).toBe('update')
    expect(Object.keys(patch)).toEqual(['completed_at'])
    expect(Date.parse(patch.completed_at)).toBeGreaterThanOrEqual(before)
    expect(call.ops.slice(1)).toEqual([['eq', 'id', 'c-job1'], ['eq', 'user_id', 'owner-1'], ['select'], ['single']])
    expect(columnsOf('fh_contacts')).toEqual(expect.arrayContaining(['completed_at', 'user_id']))
  })
})
