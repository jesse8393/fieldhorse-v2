import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the client module so importing stages.ts doesn't try to construct a
// real Supabase client in the test env. The stub is a tiny in-memory
// table store: enough of the query builder (select / insert / upsert /
// update / eq / in / maybeSingle) for logPayment, and it applies every
// filter the code sends, so a stray user_id filter shows up as a miss.
const fake = vi.hoisted(() => {
  const state = { tables: {} as Record<string, any[]> }
  function from(table: string) {
    const q = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete',
      filters: [] as Array<(r: any) => boolean>,
      single: false,
      patch: null as any,
      row: null as any
    }
    function run() {
      const rows = (state.tables[table] ||= [])
      if (q.op === 'insert') {
        rows.push({ ...q.row })
        return { data: null, error: null }
      }
      const matched = rows.filter((r) => q.filters.every((f) => f(r)))
      if (q.op === 'update') {
        for (const r of matched) Object.assign(r, q.patch)
        return { data: matched.map((r) => ({ id: r.id })), error: null }
      }
      if (q.op === 'delete') {
        state.tables[table] = rows.filter((r) => !matched.includes(r))
        return { data: matched.map((r) => ({ id: r.id })), error: null }
      }
      return { data: q.single ? (matched[0] ?? null) : matched.map((r) => ({ ...r })), error: null }
    }
    const api: any = {
      select: () => api,
      insert: (row: any) => { q.op = 'insert'; q.row = row; return api },
      upsert: (row: any) => { q.op = 'insert'; q.row = row; return api },
      update: (patch: any) => { q.op = 'update'; q.patch = patch; return api },
      delete: () => { q.op = 'delete'; return api },
      eq: (col: string, val: any) => { q.filters.push((r) => r[col] === val); return api },
      in: (col: string, vals: any[]) => { q.filters.push((r) => vals.includes(r[col])); return api },
      maybeSingle: () => { q.single = true; return api },
      single: () => { q.single = true; return api },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject)
    }
    return api
  }
  return { state, supabase: { from } }
})

vi.mock('./supabase.ts', () => ({ supabase: fake.supabase }))

const { margin, marginTier, logPayment, deletePayment, HIDDEN_STAGES, isMovedStage, STAGES, STAGE_MAP, LIST_STAGE_META, detailRoute } = await import('./stages.ts')

// SPEC D55 and D56: fh_contacts keeps job, closed and lost as the stages a
// person can pick. Rows copied into fh_leads and fh_quotes are marked
// moved_lead or moved_quote and never show anywhere.
describe('hidden stages', () => {
  it('names the two moved markers', () => {
    expect(HIDDEN_STAGES).toEqual(['moved_lead', 'moved_quote'])
  })

  it('isMovedStage is true only for the two markers', () => {
    expect(isMovedStage('moved_lead')).toBe(true)
    expect(isMovedStage('moved_quote')).toBe(true)
    for (const s of ['lead', 'quote', 'job', 'invoice', 'closed', 'lost', '', null, undefined]) {
      expect(isMovedStage(s)).toBe(false)
    }
  })

  it('offers only job, closed and lost as stage choices', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['job', 'closed', 'lost'])
  })

  it('never labels a moved row', () => {
    expect(STAGE_MAP.moved_lead).toBeUndefined()
    expect(STAGE_MAP.moved_quote).toBeUndefined()
    expect(LIST_STAGE_META.moved_lead).toBeUndefined()
    expect(LIST_STAGE_META.moved_quote).toBeUndefined()
  })

  it('routes a lost contact to the job screen, since lost leads moved out', () => {
    expect(detailRoute({ id: 'a', stage: 'job' })).toBe('/jobs/a')
    expect(detailRoute({ id: 'a', stage: 'lost' })).toBe('/jobs/a')
    expect(detailRoute({ id: 'a', stage: 'invoice' })).toBe('/jobs/a')
    expect(detailRoute({ id: 'a', stage: 'moved_lead' })).toBe('/jobs/a')
    expect(detailRoute({ id: 'a', stage: 'closed' }, { financials: true })).toBe('/jobs/a?tab=financials')
  })
})

describe('margin', () => {
  it('is 0 when there is no contract amount', () => {
    expect(margin({ amount: 0, cost: 0 })).toBe(0)
    expect(margin({ amount: 0, cost: 500 })).toBe(0)
    expect(margin(null)).toBe(0)
    expect(margin(undefined)).toBe(0)
  })

  it('computes (amount - cost) / amount as a percentage', () => {
    expect(margin({ amount: 1000, cost: 700 })).toBe(30)
    expect(margin({ amount: 1000, cost: 0 })).toBe(100)
    expect(margin({ amount: 2000, cost: 1500 })).toBe(25)
  })

  it('goes negative when cost exceeds the contract', () => {
    expect(margin({ amount: 1000, cost: 1200 })).toBe(-20)
  })

  // M-15: the contract includes approved change orders.
  it('counts approved change orders in the contract', () => {
    const changeOrders = [{ amount: 5000, status: 'approved' }, { amount: 900, status: 'sent' }]
    expect(margin({ amount: 10000, cost: 12000 }, changeOrders)).toBe(20)
  })

  it('treats null/undefined cost as zero', () => {
    expect(margin({ amount: 1000, cost: null })).toBe(100)
    expect(margin({ amount: 1000 } as any)).toBe(100)
  })
})

describe('marginTier', () => {
  it('classifies healthy / thin / warning bands', () => {
    expect(marginTier(40)).toBe('good')
    expect(marginTier(30)).toBe('good')
    expect(marginTier(29.9)).toBe('warn')
    expect(marginTier(15)).toBe('warn')
    expect(marginTier(14.9)).toBe('thin')
    expect(marginTier(0)).toBe('thin')
    expect(marginTier(-20)).toBe('thin')
  })
})

describe('logPayment', () => {
  // The owner created the job; an admin created its invoice and change
  // orders, so those rows carry the admin's user_id.
  const job = { id: 'job', user_id: 'owner', stage: 'job', name: 'Kitchen', job_title: null, address: null, amount: 10000 }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.state.tables = {
      fh_contacts: [{ ...job }],
      fh_invoices: [],
      fh_payments: [],
      fh_change_orders: [],
      fh_notifications: []
    }
  })

  const invoice = (id: string, sequence_number: number, amount: number, status = 'sent') =>
    ({ id, contact_id: 'job', user_id: 'admin', sequence_number, amount, status })

  it('settles a teammate\'s invoice when a payment logged against the job pays it', async () => {
    fake.state.tables.fh_invoices = [invoice('final', 1, 10000)]
    const res: any = await logPayment(job, { amount: 10000 })
    expect(fake.state.tables.fh_invoices[0].status).toBe('paid')
    expect(res.closed).toBe(true)
  })

  it('settles a teammate\'s invoice the payment is linked to', async () => {
    fake.state.tables.fh_invoices = [invoice('dep', 1, 5000), invoice('fin', 2, 5000)]
    await logPayment(job, { amount: 5000, invoice_id: 'dep' })
    expect(fake.state.tables.fh_invoices.map((r) => r.status)).toEqual(['paid', 'sent'])
  })

  it('leaves a partially paid invoice open and marks a paid draft as sent', async () => {
    fake.state.tables.fh_invoices = [invoice('dep', 1, 5000, 'draft')]
    await logPayment(job, { amount: 2000, invoice_id: 'dep' })
    expect(fake.state.tables.fh_invoices[0].status).toBe('sent')
  })

  it('counts every payment on the job, whoever logged it', async () => {
    fake.state.tables.fh_payments = [{ id: 'p0', contact_id: 'job', user_id: 'crew', amount: 6000, invoice_id: null }]
    fake.state.tables.fh_invoices = [invoice('a', 1, 5000), invoice('b', 2, 5000)]
    const res: any = await logPayment(job, { amount: 4000 })
    expect(res.total).toBe(10000)
    expect(res.closed).toBe(true)
    expect(fake.state.tables.fh_invoices.map((r) => r.status)).toEqual(['paid', 'paid'])
  })

  it('includes a teammate\'s approved change order before auto-closing', async () => {
    fake.state.tables.fh_change_orders = [{ id: 'co', contact_id: 'job', user_id: 'admin', amount: 2000, status: 'approved' }]
    const res: any = await logPayment(job, { amount: 10000 })
    expect(res.closed).toBe(false)
    expect(fake.state.tables.fh_contacts[0].stage).toBe('job')
  })

  // M-11: 500.04 + 400.03 + 100 is 1000.0699999999999 as floats.
  it('closes a $1,000.07 job once its three generated draws are paid', async () => {
    const centsJob = { ...job, amount: 1000.07 }
    fake.state.tables.fh_contacts = [{ ...centsJob }]
    const draws = [500.04, 400.03, 100]
    fake.state.tables.fh_invoices = draws.map((amount, i) => invoice(`inv${i + 1}`, i + 1, amount))
    let last: any
    for (let i = 0; i < draws.length; i++) {
      last = await logPayment(centsJob, { id: `p${i + 1}`, amount: draws[i], invoice_id: `inv${i + 1}` })
    }
    expect(fake.state.tables.fh_invoices.map((r) => r.status)).toEqual(['paid', 'paid', 'paid'])
    expect({ closed: last.closed, stage: fake.state.tables.fh_contacts[0].stage, total: last.total }).toEqual({ closed: true, stage: 'closed', total: 1000.07 })
  })

  it('does not close a job that is one cent short', async () => {
    const centsJob = { ...job, amount: 1000.07 }
    fake.state.tables.fh_contacts = [{ ...centsJob }]
    const res: any = await logPayment(centsJob, { amount: 1000.06 })
    expect(res.closed).toBe(false)
    expect(fake.state.tables.fh_contacts[0].stage).toBe('job')
  })

  // M-14: with no price the change order is not the whole contract.
  it('does not close a job with no price when a payment covers only its change order', async () => {
    const openJob = { ...job, amount: 0 }
    fake.state.tables.fh_contacts = [{ ...openJob }]
    fake.state.tables.fh_change_orders = [{ id: 'co', contact_id: 'job', user_id: 'admin', amount: 500, status: 'approved' }]
    fake.state.tables.fh_invoices = [invoice('a', 1, 1000), invoice('b', 2, 1000)]
    const res: any = await logPayment(openJob, { amount: 1000 })
    expect(res.closed).toBe(false)
    expect(fake.state.tables.fh_contacts[0].stage).toBe('job')
    expect(fake.state.tables.fh_invoices.map((r) => r.status)).toEqual(['paid', 'sent'])
  })

  it('never touches void invoices', async () => {
    fake.state.tables.fh_invoices = [invoice('v', 1, 10000, 'void')]
    await logPayment(job, { amount: 10000, invoice_id: 'v' })
    expect(fake.state.tables.fh_invoices[0].status).toBe('void')
  })
})

// M-08 and DATA-03: a delete that removes nothing must not read as done,
// and a real delete must undo what that payment settled.
describe('deletePayment', () => {
  const job = { id: 'job', user_id: 'owner', stage: 'closed', name: 'Kitchen', job_title: null, address: null, amount: 5000 }
  const invoice = (id: string, sequence_number: number, amount: number, status = 'paid') =>
    ({ id, contact_id: 'job', user_id: 'admin', sequence_number, amount, status })

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fake.state.tables = { fh_contacts: [{ ...job }], fh_invoices: [], fh_payments: [], fh_change_orders: [], fh_closeouts: [] }
  })

  it('deletes a teammate\'s payment by its id', async () => {
    fake.state.tables.fh_payments = [{ id: 'p1', contact_id: 'job', user_id: 'owner', amount: 5000, invoice_id: null }]
    const res: any = await deletePayment(job, 'p1')
    expect(res.error).toBeNull()
    expect(fake.state.tables.fh_payments).toEqual([])
  })

  it('reports a failure when no row was deleted', async () => {
    const res: any = await deletePayment(job, 'gone')
    expect(res.error).toBeTruthy()
    expect(fake.state.tables.fh_contacts[0].stage).toBe('closed')
  })

  it('reopens the invoice the payment paid and the job it closed', async () => {
    fake.state.tables.fh_invoices = [invoice('fin', 1, 5000)]
    fake.state.tables.fh_payments = [{ id: 'p1', contact_id: 'job', user_id: 'owner', amount: 5000, invoice_id: 'fin' }]
    const res: any = await deletePayment(job, 'p1')
    expect(res.error).toBeNull()
    expect(fake.state.tables.fh_invoices[0].status).toBe('sent')
    expect(fake.state.tables.fh_contacts[0].stage).toBe('job')
    expect(res.reopenedInvoices).toEqual(['fin'])
    expect(res.reopenedJob).toBe(true)
  })

  it('reopens only the bills money logged against the job no longer covers', async () => {
    fake.state.tables.fh_invoices = [invoice('dep', 1, 2500.5), invoice('fin', 2, 2499.5)]
    fake.state.tables.fh_payments = [
      { id: 'p1', contact_id: 'job', user_id: 'owner', amount: 2500.5, invoice_id: null },
      { id: 'p2', contact_id: 'job', user_id: 'owner', amount: 2499.5, invoice_id: null }
    ]
    await deletePayment(job, 'p2')
    expect(fake.state.tables.fh_invoices.map((r) => r.status)).toEqual(['paid', 'sent'])
    expect(fake.state.tables.fh_contacts[0].stage).toBe('job')
  })

  it('leaves an invoice marked paid by hand and a job closed out by hand', async () => {
    fake.state.tables.fh_invoices = [invoice('hand', 1, 5000)]
    fake.state.tables.fh_payments = [{ id: 'p1', contact_id: 'job', user_id: 'owner', amount: 100, invoice_id: null }]
    fake.state.tables.fh_closeouts = [{ id: 'c1', contact_id: 'job' }]
    await deletePayment(job, 'p1')
    expect(fake.state.tables.fh_invoices[0].status).toBe('paid')
    expect(fake.state.tables.fh_contacts[0].stage).toBe('closed')
  })
})

