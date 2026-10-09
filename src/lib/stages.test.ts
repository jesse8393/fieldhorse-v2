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
      op: 'select' as 'select' | 'insert' | 'update',
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
        return { data: null, error: null }
      }
      return { data: q.single ? (matched[0] ?? null) : matched.map((r) => ({ ...r })), error: null }
    }
    const api: any = {
      select: () => api,
      insert: (row: any) => { q.op = 'insert'; q.row = row; return api },
      upsert: (row: any) => { q.op = 'insert'; q.row = row; return api },
      update: (patch: any) => { q.op = 'update'; q.patch = patch; return api },
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

const { margin, marginTier, logPayment } = await import('./stages.ts')

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

  it('never touches void invoices', async () => {
    fake.state.tables.fh_invoices = [invoice('v', 1, 10000, 'void')]
    await logPayment(job, { amount: 10000, invoice_id: 'v' })
    expect(fake.state.tables.fh_invoices[0].status).toBe('void')
  })
})
