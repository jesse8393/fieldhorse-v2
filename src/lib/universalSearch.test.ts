import { beforeEach, describe, expect, it, vi } from 'vitest'
import { universalSearch } from './universalSearch.ts'
import type { OrgRole } from './permissions.ts'

const db = vi.hoisted(() => ({
  reads: [] as { table: string; columns: string; filters: [string, string][] }[],
  failedTable: '',
  amount: 12345 as number,
}))

vi.mock('./orgScope.ts', () => ({ lastKnownOrg: () => 'org-1' }))
vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => {
  const read = { table, columns: '', filters: [] as [string, string][] }
  db.reads.push(read)
  const builder = {
    select(columns: string) { read.columns = columns; return builder },
    eq(column: string, value: string) { read.filters.push([column, value]); return builder },
    not() { return builder },
    or() { return builder },
    ilike() { return builder },
    order() { return builder },
    async limit() {
      // Deliberately include amount even when omitted from select, proving
      // display filtering as well as the actual requested columns.
      return {
        data: [{ id: 'record-1', name: 'Assigned job', title: 'Site work', stage: 'job', amount: db.amount, text: 'Site note', filename: 'Plan.pdf' }],
        error: table === db.failedTable ? { message: 'Read refused' } : null,
      }
    },
  }
  return builder
} } }))

beforeEach(() => { db.reads = []; db.failedTable = ''; db.amount = 12345 })

describe('search role boundaries', () => {
  it.each<OrgRole>(['crew', 'foreman'])('keeps %s search useful without requesting restricted records or amounts', async role => {
    db.failedTable = 'fh_quotes'
    const result = await universalSearch('Site', 'user-1', 'org-1', role)
    expect(db.reads.map(r => r.table)).toEqual(['fh_contacts', 'fh_notes', 'fh_schedule', 'fh_job_files'])
    expect(db.reads.find(r => r.table === 'fh_contacts')!.columns).not.toContain('amount')
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].sub).not.toMatch(/\$|12,345/)
    for (const group of [result.leads, result.quotes, result.invoices, result.clients]) expect(group).toEqual([])
    expect(result.total).toBe(4)
    for (const read of db.reads) expect(read.filters).toContainEqual(read.table === 'fh_notes' ? ['user_id', 'user-1'] : ['org_id', 'org-1'])
  })

  it.each<OrgRole>(['owner', 'admin', 'manager'])('retains financial results for %s while respecting customer directory access', async role => {
    const result = await universalSearch('Site', 'user-1', 'org-1', role)
    expect(result.quotes).toHaveLength(1)
    expect(result.invoices).toHaveLength(1)
    expect(result.jobs[0].sub).toContain('$12,345')
    expect(db.reads.find(r => r.table === 'fh_contacts')!.columns).toContain('amount')
    expect(result.clients).toHaveLength(role === 'manager' ? 0 : 1)
  })

  it('keeps title and customer searches unambiguous when company foreign keys coexist', async () => {
    await universalSearch('Site', 'user-1', 'org-1', 'owner')
    for (const table of ['fh_leads', 'fh_quotes', 'fh_invoices']) {
      const queries = db.reads.filter(read => read.table === table)
      expect(queries).toHaveLength(2)
      expect(queries[0].columns).toContain(`fh_clients!${table}_client_id_fkey(name)`)
      expect(queries[1].columns).toContain(`fh_clients!${table}_client_id_fkey!inner(name)`)
    }
  })

  it('waits for a confirmed role instead of defaulting to owner access', async () => {
    expect((await universalSearch('Site', 'user-1', 'org-1')).total).toBe(0)
    expect(db.reads).toEqual([])
  })

  it('reports an allowed query failure instead of presenting an empty success', async () => {
    db.failedTable = 'fh_quotes'
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(universalSearch('Site', 'user-1', 'org-1', 'owner')).rejects.toThrow("Search isn't working right now")
    } finally { warning.mockRestore() }
  })
})

// formats-3: Search names a record's amount to the cent, the figure the
// record itself shows, never rounded to whole dollars.
describe('search money', () => {
  it('keeps the cents on jobs, quotes and invoices', async () => {
    db.amount = 12345.5
    const result = await universalSearch('Site', 'user-1', 'org-1', 'owner')
    expect(result.jobs[0].sub).toContain('$12,345.50')
    expect(result.quotes[0].sub).toContain('$12,345.50')
    expect(result.invoices[0].sub).toContain('$12,345.50')
    expect(result.jobs[0].sub).not.toContain('$12,346')
  })

  it('prints a whole amount with .00', async () => {
    db.amount = 4200
    const result = await universalSearch('Site', 'user-1', 'org-1', 'owner')
    expect(result.invoices[0].sub).toContain('$4,200.00')
  })
})

// formats-1: Search shows an invoice by the number its PDF prints, and a
// typed number finds the invoice it names.
describe('search by invoice number', () => {
  it('shows the printed number and finds an invoice by it', async () => {
    const result = await universalSearch('PCC-RD-01', 'user-1', 'org-1', 'owner', 'Parker Construction Company')
    const numberRead = db.reads.filter((r) => r.table === 'fh_invoices').find((r) => r.filters.some(([column]) => column === 'sequence_number'))
    expect(numberRead?.filters).toContainEqual(['sequence_number', 1 as unknown as string])
    expect(result.invoices[0].sub).toContain('PCC-')
  })

  it('a text that is not a number reads no invoice by sequence', async () => {
    await universalSearch('Harold', 'user-1', 'org-1', 'owner', 'Parker Construction Company')
    expect(db.reads.some((r) => r.filters.some(([column]) => column === 'sequence_number'))).toBe(false)
  })
})
