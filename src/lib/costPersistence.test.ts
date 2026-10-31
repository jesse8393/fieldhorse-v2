import { beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, any[]>,
    failedRead: '',
    permissionError: false,
    moneyVisible: true,
    rejectedWrite: false,
    filteredWrite: false,
    failedRateRead: false,
  }
  const from = (table: string) => {
    let patch: Record<string, unknown> | undefined
    let single = false
    let rateRead = false
    const filters: ((row: any) => boolean)[] = []
    const run = () => {
      if (!patch && state.failedRead === table) return { data: null, error: { message: 'Read unavailable' } }
      if (table === 'org_members' && rateRead && state.failedRateRead) return { data: null, error: { message: 'Rates unavailable' } }
      const rows = (state.tables[table] || []).filter(row => filters.every(filter => filter(row)))
      if (patch) {
        if (state.rejectedWrite) return { data: null, error: { message: 'Write refused' } }
        if (state.filteredWrite) return { data: [], error: null }
        rows.forEach(row => Object.assign(row, patch))
      }
      return { data: single ? rows[0] ?? null : rows.map(row => ({ ...row })), error: null }
    }
    const q: any = {
      select: () => q,
      update: (value: Record<string, unknown>) => { patch = value; return q },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q },
      is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      not: (key: string, _operator: string, value: unknown) => { filters.push(row => row[key] !== value); return q },
      in: (key: string, values: unknown[]) => { rateRead = true; filters.push(row => values.includes(row[key])); return q },
      maybeSingle: () => { single = true; return q },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    }
    return q
  }
  return { state, supabase: { from, rpc: async () => ({ data: state.permissionError ? null : state.moneyVisible, error: state.permissionError ? { message: 'Permission check unavailable' } : null }) }, toastError: vi.fn() }
})

vi.mock('./supabase.ts', () => ({ supabase: fake.supabase }))
vi.mock('./toast.ts', () => ({ toastError: fake.toastError }))
const { recalcCost } = await import('./stages.ts')

beforeEach(() => {
  Object.assign(fake.state, { failedRead: '', permissionError: false, moneyVisible: true, rejectedWrite: false, filteredWrite: false, failedRateRead: false })
  fake.toastError.mockClear()
  fake.state.tables = {
    fh_contacts: [{ id: 'job', user_id: 'owner', org_id: 'org', cost: 999 }],
    fh_subs: [{ contact_id: 'job', rate: 200 }],
    fh_expenses: [{ contact_id: 'job', amount: 300 }],
    fh_time_punches: [{ contact_id: 'job', user_id: 'crew', org_id: 'org', punch_in_at: '2026-10-31T08:00:00Z', punch_out_at: '2026-10-31T09:00:00Z', hourly_rate: null, flagged: false }],
    org_members: [
      { user_id: 'crew', org_id: 'org', role: 'crew', default_hourly_rate: 50, revoked_at: null },
      { user_id: 'admin', org_id: 'org', role: 'manager', revoked_at: null },
    ],
  }
})

it('persists a complete sum including another member’s rated labor', async () => {
  expect(await recalcCost('job', 'admin')).toBe(550)
  expect(fake.state.tables.fh_contacts[0].cost).toBe(550)
})

it.each(['fh_contacts', 'fh_subs', 'fh_expenses', 'fh_time_punches', 'org_members'])('preserves saved cost when %s cannot be read', async table => {
  fake.state.failedRead = table
  expect(await recalcCost('job', 'admin')).toBeNull()
  expect(fake.state.tables.fh_contacts[0].cost).toBe(999)
})

it('preserves saved cost when the permission check fails', async () => {
  fake.state.permissionError = true
  expect(await recalcCost('job', 'admin')).toBeNull()
  expect(fake.state.tables.fh_contacts[0].cost).toBe(999)
})

it('leaves financial totals unchanged for field roles', async () => {
  fake.state.moneyVisible = false
  expect(await recalcCost('job', 'crew')).toBeNull()
  expect(fake.state.tables.fh_contacts[0].cost).toBe(999)
})

it('never replaces the job total from an outside partner’s partial reads', async () => {
  expect(await recalcCost('job', 'outside-partner')).toBeNull()
  expect(fake.state.tables.fh_contacts[0].cost).toBe(999)
})

it('preserves saved cost when required crew rates cannot be read', async () => {
  fake.state.failedRateRead = true
  expect(await recalcCost('job', 'admin')).toBeNull()
  expect(fake.state.tables.fh_contacts[0].cost).toBe(999)
})

it.each(['rejectedWrite', 'filteredWrite'] as const)('does not report a saved total after %s', async failure => {
  fake.state[failure] = true
  expect(await recalcCost('job', 'admin')).toBeNull()
  expect(fake.state.tables.fh_contacts[0].cost).toBe(999)
  expect(fake.toastError).toHaveBeenCalled()
})
