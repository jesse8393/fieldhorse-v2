import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDatabaseTypes } from '../../scripts/lib/schemaRefs.mjs'
import { removeDemoData, seedDemoData } from './demoSeed.ts'

// What Start with sample data writes, held against the screens that read
// it: leads on fh_leads, quotes on fh_quotes with their lines, jobs on
// fh_contacts at stage job, closed or lost. A lead or quote stage row on
// fh_contacts shows on no screen. Remove sample data must take every one
// of those rows back out and leave real work alone.

type Row = Record<string, any>

// A small in memory database with the query shapes the seed and the
// removal use: insert then select, select with eq, is and in filters,
// maybeSingle, and delete with a count. failDelete makes a table's
// delete fail with that message.
function fakeDb(initial: Record<string, Row[]> = {}, failDelete: Record<string, string> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }))
  let next = 0
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let op: 'select' | 'insert' | 'delete' = 'select'
    let inserted: Row[] = []
    let single = false
    const b: any = {
      select: () => b,
      insert: (rows: Row | Row[]) => {
        op = 'insert'
        inserted = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `${table}-${++next}`, ...r }))
        return b
      },
      delete: () => { op = 'delete'; return b },
      eq: (col: string, value: unknown) => { filters.push((r) => r[col] === value); return b },
      is: (col: string, value: unknown) => { filters.push((r) => (r[col] ?? null) === value); return b },
      in: (col: string, values: unknown[]) => { filters.push((r) => values.includes(r[col])); return b },
      maybeSingle: () => { single = true; return b },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        const rows = (tables[table] ??= [])
        if (op === 'insert') {
          rows.push(...inserted)
          return { data: inserted.map((r) => ({ ...r })), error: null }
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)))
        if (op === 'delete') {
          if (failDelete[table]) return { data: null, error: { message: failDelete[table] }, count: null }
          tables[table] = rows.filter((r) => !hit.includes(r))
          return { data: null, error: null, count: hit.length }
        }
        return { data: single ? (hit[0] ?? null) : hit, error: null }
      }).then(resolve, reject)
    }
    return b
  }
  return { tables, client: { from } }
}

const USER = 'user-1'
const ORG = 'org-1'
const owner = (failDelete: Record<string, string> = {}) =>
  fakeDb({ org_members: [{ org_id: ORG, user_id: USER, role: 'owner', revoked_at: null }] }, failDelete)

describe('seedDemoData', () => {
  it('puts the sample lead on fh_leads and the sample quote with its lines on fh_quotes', async () => {
    const db = owner()
    await seedDemoData(db.client, USER, ORG)
    const clients = db.tables.fh_clients
    const patel = clients.find((c) => c.name === 'Jane Patel')
    const henderson = clients.find((c) => c.name === 'Henderson Family')

    const lead = (db.tables.fh_leads ?? []).find((l) => l.title === 'Front yard redesign')
    expect(lead).toMatchObject({ client_id: patel?.id, status: 'open', user_id: USER, org_id: ORG })

    const quote = (db.tables.fh_quotes ?? []).find((q) => q.title === 'Primary bath refresh')
    expect(quote).toMatchObject({ client_id: henderson?.id, user_id: USER, org_id: ORG })
    const lines = (db.tables.fh_quote_items ?? []).filter((i) => i.quote_id === quote?.id)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatchObject({ contact_id: null, user_id: USER, org_id: ORG })
    expect(lines.reduce((sum, i) => sum + i.amount, 0)).toBe(quote?.amount)
  })

  it('writes only jobs to fh_contacts, never a lead or quote stage', async () => {
    const db = owner()
    await seedDemoData(db.client, USER, ORG)
    const stages = db.tables.fh_contacts.map((c) => c.stage)
    expect(stages.length).toBeGreaterThan(0)
    for (const stage of stages) expect(['job', 'closed', 'lost']).toContain(stage)
  })

  it('points every visit, note, todo and expense at a sample record that exists', async () => {
    const db = owner()
    await seedDemoData(db.client, USER, ORG)
    const ids = (t: string) => new Set((db.tables[t] ?? []).map((r) => r.id))
    const jobs = ids('fh_contacts')
    const leads = ids('fh_leads')
    for (const t of ['fh_schedule', 'fh_notes']) {
      for (const r of db.tables[t]) {
        expect(Boolean(r.contact_id) !== Boolean(r.lead_id), `${t} ${r.title ?? r.text}`).toBe(true)
        if (r.contact_id) expect(jobs.has(r.contact_id)).toBe(true)
        if (r.lead_id) expect(leads.has(r.lead_id)).toBe(true)
      }
    }
    for (const r of db.tables.fh_job_todos) expect(jobs.has(r.job_id)).toBe(true)
    for (const r of db.tables.fh_expenses) expect(jobs.has(r.contact_id)).toBe(true)
  })

  it('writes only columns the database has', async () => {
    const db = owner()
    await seedDemoData(db.client, USER, ORG)
    const schema = parseDatabaseTypes(fs.readFileSync(new URL('./database.types.ts', import.meta.url), 'utf8'))
    for (const [table, rows] of Object.entries(db.tables)) {
      if (table === 'org_members') continue
      const columns = new Set(schema.tables[table]?.columns ?? [])
      for (const row of rows) for (const key of Object.keys(row)) expect(columns.has(key), `${table}.${key}`).toBe(true)
    }
  })
})

describe('removeDemoData', () => {
  it('removes every sample row, the lead and quote included, and keeps real work', async () => {
    const db = owner()
    await seedDemoData(db.client, USER, ORG)
    const seeded = Object.values(db.tables).flat().length - 1
    // Real work the owner added beside the samples.
    db.tables.fh_clients.push({ id: 'real-client', user_id: USER, name: 'Real customer', source: null })
    db.tables.fh_leads.push({ id: 'real-lead', user_id: USER, client_id: 'real-client', title: 'Patio', status: 'open' })
    db.tables.fh_quotes.push({ id: 'real-quote', user_id: USER, client_id: 'real-client', title: 'Patio', amount: 900 })
    db.tables.fh_quote_items.push({ id: 'real-line', user_id: USER, quote_id: 'real-quote', contact_id: null, description: 'Pour', amount: 900 })
    db.tables.fh_contacts.push({ id: 'real-job', user_id: USER, client_id: 'real-client', stage: 'job', source: null })
    db.tables.fh_schedule.push({ id: 'real-visit', user_id: USER, contact_id: 'real-job', lead_id: null, title: 'Pour' })

    const removed = await removeDemoData(db.client, USER)

    expect(removed).toBe(seeded)
    const left = Object.entries(db.tables)
      .filter(([t]) => t !== 'org_members')
      .flatMap(([t, rows]) => rows.map((r) => `${t}:${r.id}`))
      .sort()
    expect(left).toEqual([
      'fh_clients:real-client', 'fh_contacts:real-job', 'fh_leads:real-lead',
      'fh_quote_items:real-line', 'fh_quotes:real-quote', 'fh_schedule:real-visit'
    ])
  })

  // Settings shows "Couldn't remove sample data: <message>". The jobs and
  // clients deletes have always passed the bare message through; only the
  // child tables name themselves. The errors lane owns that wording.
  it('keeps the bare message when the jobs or clients delete fails', async () => {
    for (const table of ['fh_contacts', 'fh_clients']) {
      const db = owner({ [table]: 'permission denied' })
      await seedDemoData(db.client, USER, ORG)
      await expect(removeDemoData(db.client, USER)).rejects.toThrow(/^permission denied$/)
    }
  })

  it('says nothing was removed when there is no sample data', async () => {
    const db = owner()
    expect(await removeDemoData(db.client, USER)).toBe(0)
  })
})
