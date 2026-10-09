import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal chainable stand-in for the supabase query builder. Records every
// call per request so tests can assert how each table was scoped.
type Call = { table: string; ops: any[][] }
const calls: Call[] = []
const results: Record<string, any> = {}

function builder(table: string) {
  const entry: Call = { table, ops: [] }
  calls.push(entry)
  const result = () => results[table] ?? { data: null, error: null }
  const b: any = {}
  for (const m of ['select', 'eq', 'delete', 'insert', 'upsert', 'update', 'order']) {
    b[m] = (...args: any[]) => { entry.ops.push([m, ...args]); return b }
  }
  b.maybeSingle = () => { entry.ops.push(['maybeSingle']); return Promise.resolve(result()) }
  b.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject)
  return b
}

const { transitionStage } = vi.hoisted(() => ({
  transitionStage: vi.fn(async (..._args: any[]) => ({ data: null, error: null }))
}))
vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => builder(table) } }))
vi.mock('./stages.ts', () => ({ transitionStage }))

const { closeoutBalance, snapshotJobTotals, loadCloseout, saveCloseout, clearCloseout } = await import('./closeout.ts')

function filtersOn(table: string) {
  return calls
    .filter((c) => c.table === table)
    .flatMap((c) => c.ops.filter((op) => op[0] === 'eq').map((op) => op[1]))
}

beforeEach(() => {
  calls.length = 0
  transitionStage.mockClear()
  for (const k of Object.keys(results)) delete results[k]
  results.fh_payments = { data: [{ amount: 4000 }, { amount: 6000 }], error: null }
  results.fh_job_files = { count: 3, error: null }
  results.fh_change_orders = { data: [{ amount: 2000, status: 'approved' }], error: null }
})

describe('closeoutBalance', () => {
  it('includes approved change orders in what is still owed', () => {
    expect(closeoutBalance(10000, 2000, 10000)).toBe(2000)
    expect(closeoutBalance('10000', '2000', '4000')).toBe(8000)
  })

  it('never goes below zero and treats blanks as zero', () => {
    expect(closeoutBalance(10000, 0, 12000)).toBe(0)
    expect(closeoutBalance(null, undefined, null)).toBe(0)
  })
})

describe('closeout reads are scoped by the job, not the caller', () => {
  it('snapshotJobTotals counts every payment and approved CO on the job', async () => {
    const totals = await snapshotJobTotals({ userId: 'admin-1', contactId: 'job-1' })
    expect(totals).toEqual({ paid: 10000, photoCount: 3, approvedCO: 2000 })
    for (const table of ['fh_payments', 'fh_job_files', 'fh_change_orders']) {
      expect(filtersOn(table)).not.toContain('user_id')
    }
    expect(filtersOn('fh_payments')).toContain('contact_id')
    expect(filtersOn('fh_job_files')).toContain('job_id')
  })

  it('loadCloseout finds the job closeout whoever saved it', async () => {
    results.fh_closeouts = { data: { id: 'co-1', user_id: 'owner-1' }, error: null }
    const row = await loadCloseout({ userId: 'admin-1', contactId: 'job-1' })
    expect(row).toEqual({ id: 'co-1', user_id: 'owner-1' })
    expect(filtersOn('fh_closeouts')).toEqual(['contact_id'])
  })

  it('clearCloseout deletes by job only', async () => {
    await clearCloseout({ userId: 'admin-1', contact: { id: 'job-1', user_id: 'owner-1', stage: 'job' } as any })
    expect(filtersOn('fh_closeouts')).toEqual(['contact_id'])
  })
})

describe('saveCloseout', () => {
  it('keeps the job owner on the row and snapshots the full contract', async () => {
    const contact = { id: 'job-1', user_id: 'owner-1', amount: 10000, stage: 'job' } as any
    const row = await saveCloseout({ userId: 'admin-1', contact, payload: { signoff_method: 'verbal' } })
    expect(row.user_id).toBe('owner-1')
    expect(row.final_amount).toBe(12000)
    expect(row.paid_at_close).toBe(10000)
    const upsert = calls.find((c) => c.table === 'fh_closeouts')?.ops.find((op) => op[0] === 'upsert')
    expect(upsert?.[1]?.user_id).toBe('owner-1')
    expect(transitionStage).toHaveBeenCalledWith(contact, 'closed')
  })
})
