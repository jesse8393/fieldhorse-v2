import { describe, it, expect, vi, beforeEach } from 'vitest'

const mock = vi.hoisted(() => ({ results: new Map<string, unknown>(), options: null as any, invalidate: vi.fn(), calls: [] as any[], storageResult: null as any }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => { mock.options = options; return options },
  useQueryClient: () => ({ invalidateQueries: mock.invalidate })
}))
vi.mock('./supabase', () => ({ supabase: {
  rpc: (name: string, args: unknown) => { mock.calls.push(['rpc', name, args]); return Promise.resolve(mock.results.get(`rpc:${name}`) ?? { data: null, error: null }) },
  from: (table: string) => {
    let range: number[] | null = null
    const operations: any[] = []
    const chain: any = new Proxy({}, { get: (_target, key) => key === 'then'
      ? (resolve: any) => {
          const configured: any = mock.results.get(table) ?? { data: [], error: null }
          const result = typeof configured === 'function' ? configured(range, operations) : configured
          return Promise.resolve(range && Array.isArray(result.data)
            ? { ...result, data: result.data.slice(range[0], range[1] + 1) } : result).then(resolve)
        }
      : (...args: any[]) => { if (key === 'range') range = args; operations.push([String(key), ...args]); mock.calls.push([table, String(key), ...args]); return chain } })
    return chain
  },
  storage: { from: () => ({ createSignedUrls: () => Promise.resolve(mock.storageResult ?? { data: null, error: new Error('Storage unavailable') }), remove: () => Promise.resolve(mock.storageResult ?? { data: null, error: new Error('Storage unavailable') }) }) }
} }))

import { useIntegrations, useDisconnectIntegration } from './integrations'
import { useJobs, useEstimates, useUpdateStage, useCreateQuoteFromBid, useCreateLead, useSetFollowUpStatus } from './queries'
import { useMembership, moneyVisible } from './membership'
import { JOB_STAGE_CHOICES } from './stages'
import { useClientsBundle, useClientDetail, useJobDetail, useInvoiceDetail, useInvoicesOverview, useProfile, useJobPhotos, useJobFiles, useAgenda, useNotesScreen, useActivityFeed, useSubsRoster, useToggleTodo, useDeleteTodo, useUpdateJob, useUpdateProfile, useDeletePhoto, useDeleteFile, useGenerateDraws, useLogPayment, useMarkInvoicePaid, useUpdateInvoiceStatus } from './queries'

beforeEach(() => { mock.results.clear(); mock.options = null; mock.invalidate.mockClear(); mock.calls = []; mock.storageResult = null })
const failure = new Error('Synthetic read failure')
describe('native failed reads', () => {
  for (const [name, hook, table] of [
    ['integration status', () => useIntegrations('user'), 'fh_integrations'],
    ['customer job summary', () => useClientsBundle('user'), 'fh_contacts'],
    ['customer payment summary', () => useClientsBundle('user'), 'fh_payments'],
    ['customer detail', () => useClientDetail('client'), 'fh_clients'],
    ['job payments', () => useJobDetail('job'), 'fh_payments'],
    ['invoice detail payments', () => useInvoiceDetail('job'), 'fh_payments'],
    ['invoice approved changes', () => useInvoiceDetail('job'), 'fh_change_orders'],
    ['invoice overview', () => useInvoicesOverview('user'), 'fh_invoices'],
    ['invoice overview payments', () => useInvoicesOverview('user'), 'fh_payments'],
    ['profile/onboarding', () => useProfile('user'), 'profiles'],
    ['photo index', () => useJobPhotos('job'), 'fh_job_files'],
    ['file index', () => useJobFiles('job'), 'fh_job_files'],
    ['agenda', () => useAgenda('user'), 'fh_schedule'],
    ['notes', () => useNotesScreen('user'), 'fh_notes'],
    ['activity', () => useActivityFeed('user'), 'fh_payments'],
    ['subcontractor roster', () => useSubsRoster('user'), 'fh_subs'],
  ] as const) {
    it(`${name} rejects instead of returning missing records or zero money`, async () => {
      mock.results.set(table, { data: null, error: failure })
      hook()
      await expect(mock.options.queryFn()).rejects.toThrow('Synthetic read failure')
    })
  }
  it('storage signing failure is reported instead of hiding all job photos', async () => {
    mock.results.set('fh_job_files', { data: [{ id: 'photo', storage_path: 'owner/job/photo.jpg' }], error: null })
    useJobPhotos('job')
    await expect(mock.options.queryFn()).rejects.toThrow('Storage unavailable')
  })
  it('a successful empty customer book remains a valid empty result', async () => {
    useClientsBundle('user')
    await expect(mock.options.queryFn()).resolves.toEqual({ clients: [], jobs: [], payments: [] })
  })
})

describe('native complete billing totals', () => {
  it('includes payment pages and approved changes in a job balance', async () => {
    mock.results.set('fh_contacts', { data: { id: 'job', amount: 1500.75 }, error: null })
    mock.results.set('fh_payments', { data: Array.from({ length: 1001 }, (_, id) => ({ id: String(id), amount: 1 })), error: null })
    mock.results.set('fh_change_orders', { data: [{ amount: 50.25, status: 'approved' }], error: null })
    useInvoiceDetail('job')
    expect(await mock.options.queryFn()).toMatchObject({ amount: 1551, paid: 1001, balance: 550 })
    expect(mock.calls).toContainEqual(['fh_payments', 'range', 1000, 1999])
  })

  it('rejects a failed second payment page instead of showing inflated debt', async () => {
    mock.results.set('fh_contacts', { data: { id: 'job', amount: 1500 }, error: null })
    mock.results.set('fh_payments', (range: number[]) => range[0] === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => ({ id: String(id), amount: 1 })), error: null }
      : { data: null, error: new Error('Payment history interrupted') })
    useInvoiceDetail('job')
    await expect(mock.options.queryFn()).rejects.toThrow('Payment history interrupted')
  })
})

describe('native confirmed mutations', () => {
  it('marks work complete without hiding an unpaid job in the closed stage', async () => {
    mock.results.set('fh_contacts', { data: [{ id: 'job' }], error: null })
    await useUpdateJob()({ contactId: 'job', completedAt: '2026-11-01T12:00:00Z' })
    expect(mock.calls.find(c => c[1] === 'update')?.[2]).toEqual({ completed_at: '2026-11-01T12:00:00Z' })
  })
  for (const [name, hook, input, table] of [
    ['integration disconnect', useDisconnectIntegration, { userId: 'user', provider: 'jobber' }, 'fh_integrations'],
    ['task completion', useToggleTodo, { id: 'task', contactId: 'job', done: true }, 'fh_job_todos'],
    ['task deletion', useDeleteTodo, { id: 'task', contactId: 'job' }, 'fh_job_todos'],
    ['job edit', useUpdateJob, { contactId: 'job', name: 'Updated' }, 'fh_contacts'],
    ['profile edit', useUpdateProfile, { userId: 'user', companyName: 'Updated' }, 'profiles'],
  ] as const) {
    it(`${name} refuses zero affected records and retains existing cache`, async () => {
      mock.results.set(table, { data: [], error: null })
      const action = hook() as (input: any) => Promise<any>
      const result = await action(input)
      expect(result.error?.message).toContain('could not be confirmed')
      expect(mock.invalidate).not.toHaveBeenCalled()
      expect(mock.calls.some(c => c[0] === table && c[1] === 'select')).toBe(true)
    })
  }
  it('profile saves request an existing profile key', async () => {
    mock.results.set('profiles', { data: [{ user_id: 'user' }], error: null })
    const result = await useUpdateProfile()({ userId: 'user', companyName: 'Updated' })
    expect(result.error).toBeNull()
    expect(mock.calls).toContainEqual(['profiles', 'select', 'user_id'])
  })
  for (const hook of [useDeletePhoto, useDeleteFile]) {
    it('storage failure preserves its file index for retry', async () => {
      const result = await hook()({ id: 'file', path: 'owner/job/file', jobId: 'job' })
      expect(result.error?.message).toBe('Storage unavailable')
      expect(mock.calls.some(c => c[1] === 'delete')).toBe(false)
      expect(mock.invalidate).not.toHaveBeenCalled()
    })
  }
  it('a partial signed URL response remains an error, not an empty gallery', async () => {
    mock.results.set('fh_job_files', { data: [{ id: 'file', storage_path: 'owner/job/file' }], error: null })
    mock.storageResult = { data: [{ path: 'owner/job/file', error: 'Object missing' }], error: null }
    useJobPhotos('job')
    await expect(mock.options.queryFn()).rejects.toThrow('Some photos could not load')
  })
  it('draw generation submits all three rows atomically and preserves cents', async () => {
    mock.results.set('fh_invoices', { data: [{ id: 'a' },{ id: 'b' },{ id: 'c' }], error: null })
    expect((await useGenerateDraws()({ userId: 'user', contactId: 'job', contractTotal: 100.03 })).error).toBeNull()
    const inserts = mock.calls.filter(c => c[0] === 'fh_invoices' && c[1] === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0][2].map((r: any) => Math.round(r.amount * 100))).toEqual([5002,4001,1000])
  })
})

describe('native payment confirmation and allocation', () => {
  const payment = { id: 'retry-id', userId: 'user', contactId: 'job', amount: 100.25, method: 'check', paidOn: '2026-11-01' }

  it('a committed payment with a lost response is confirmed on retry without a second payment', async () => {
    const rows = new Map<string, any>()
    let loseResponse = true
    mock.results.set('fh_payments', (_range: unknown, operations: any[]) => {
      const write = operations.find(o => o[0] === 'upsert')
      if (write) {
        expect(write[2]).toEqual({ onConflict: 'id', ignoreDuplicates: true })
        if (!rows.has(write[1].id)) rows.set(write[1].id, write[1])
        if (loseResponse) { loseResponse = false; return { data: null, error: new Error('Response lost') } }
        return { data: null, error: null }
      }
      return { data: rows.get('retry-id'), error: null }
    })
    const log = useLogPayment()
    expect((await log(payment)).error?.message).toBe('Response lost')
    expect(mock.invalidate).not.toHaveBeenCalled()
    expect((await log(payment)).error).toBeNull()
    expect(rows.size).toBe(1)
    expect(rows.get('retry-id').amount).toBe(100.25)
    expect((await log({ ...payment, amount: 200 })).error?.message).toContain('different details')
    expect(rows.get('retry-id').amount).toBe(100.25)
  })

  it('rejects an unconfirmed payment and invalid amounts', async () => {
    mock.results.set('fh_payments', { data: null, error: null })
    expect((await useLogPayment()(payment)).error?.message).toContain('could not be confirmed')
    mock.calls = []
    const log = useLogPayment()
    for (const amount of [0, -1, 1.234, Infinity, NaN]) {
      expect((await log({ ...payment, amount })).error).toBeTruthy()
    }
    expect(mock.calls).toEqual([])
  })

  function settlement(status = 'sent', unlinked = 30.25, approved = 0) {
    const invoice = { id: 'invoice', contact_id: 'job', amount: 100.25, status, sequence_number: 1 }
    mock.results.set('fh_invoices', (range: number[] | null, operations: any[]) => {
      if (operations.some(o => o[0] === 'update')) return { data: [{ id: 'invoice' }], error: null }
      return { data: range ? [invoice] : invoice, error: null }
    })
    mock.results.set('fh_contacts', { data: { amount: 80.25 }, error: null })
    mock.results.set('fh_change_orders', { data: [{ amount: approved, status: 'approved' }], error: null })
    mock.results.set('fh_payments', { data: [{ amount: unlinked, invoice_id: null }], error: null })
  }

  it('records only allocated debt, including job payments and approved extras', async () => {
    settlement('sent', 30.25, 20)
    expect((await useMarkInvoicePaid()({ id: 'invoice', userId: 'user' })).error).toBeNull()
    expect(mock.calls.find(c => c[0] === 'fh_payments' && c[1] === 'insert')?.[2]).toMatchObject({ amount: 70, invoice_id: 'invoice' })
  })

  it('a fully paid job invoice settles without recording its payment again', async () => {
    settlement('sent', 100.25, 20)
    expect((await useUpdateInvoiceStatus()({ id: 'invoice', contactId: 'job', userId: 'user', status: 'paid' })).error).toBeNull()
    expect(mock.calls.some(c => c[0] === 'fh_payments' && c[1] === 'insert')).toBe(false)
    expect(mock.calls).toContainEqual(['fh_invoices', 'update', { status: 'paid' }])
  })

  it('failed financial reads and void invoices cannot record or settle money', async () => {
    settlement()
    mock.results.set('fh_change_orders', { data: null, error: new Error('Changes unavailable') })
    expect((await useMarkInvoicePaid()({ id: 'invoice', userId: 'user' })).error?.message).toBe('Changes unavailable')
    settlement('void')
    expect((await useMarkInvoicePaid()({ id: 'invoice', userId: 'user' })).error?.message).toContain('void')
    expect(mock.calls.some(c => c[1] === 'insert' || c[1] === 'update')).toBe(false)
  })
})

describe('native list reads exclude moved rows', () => {
  const MOVED = '("moved_lead","moved_quote")'
  for (const [name, hook] of [
    ['jobs list', () => useJobs()],
    ['clients bundle', () => useClientsBundle('user')],
    ['client detail', () => useClientDetail('client')],
    ['activity feed', () => useActivityFeed('user')],
    ['estimates', () => useEstimates('user')],
    ['notes job picker', () => useNotesScreen('user')],
    ['subs roster', () => useSubsRoster('user')],
  ] as const) {
    it(`${name} drops moved_lead and moved_quote rows`, async () => {
      hook()
      await mock.options.queryFn()
      const selects = mock.calls.filter(c => c[0] === 'fh_contacts' && c[1] === 'select')
      const filters = mock.calls.filter(c => c[0] === 'fh_contacts' && c[1] === 'not')
      expect(selects.length).toBeGreaterThan(0)
      expect(filters).toEqual(selects.map(() => ['fh_contacts', 'not', 'stage', 'in', MOVED]))
    })
  }
})

describe('native job stage changes', () => {
  it('offers only job, closed and lost', () => {
    expect([...JOB_STAGE_CHOICES]).toEqual(['job', 'closed', 'lost'])
  })
  for (const stage of ['lead', 'quote', 'invoice', 'moved_lead']) {
    it(`refuses to set a job to ${stage} without writing`, async () => {
      mock.results.set('fh_contacts', { data: [{ id: 'job' }], error: null })
      const result = await useUpdateStage()({ contactId: 'job', stage })
      expect(result.error).toBeTruthy()
      expect(mock.calls).toEqual([])
    })
  }
  it('still saves a closed job', async () => {
    mock.results.set('fh_contacts', { data: [{ id: 'job' }], error: null })
    expect((await useUpdateStage()({ contactId: 'job', stage: 'closed' })).error).toBeNull()
    expect(mock.calls).toContainEqual(['fh_contacts', 'update', { stage: 'closed' }])
  })
})

describe('native estimate to quote', () => {
  const bid = {
    summary: 'Driveway replacement',
    line_items: [{ name: 'Demo', qty: 2, unit: 'lump', rate_low: 100, rate_high: 150 }, { name: 'Pour', qty: 3, unit: 'sqft', rate_high: 100.5, notes: '4 inch' }],
    assumptions: ['Clear access'], risks: []
  }
  function tables(existing: any[] = []) {
    mock.results.set('fh_clients', (_r: unknown, ops: any[]) => ops.some(o => o[0] === 'insert')
      ? { data: { id: 'client-new' }, error: null } : { data: existing, error: null })
    mock.results.set('fh_quotes', { data: { id: 'quote-1' }, error: null })
    mock.results.set('fh_quote_items', { data: null, error: null })
  }

  it('bid creates an fh_quotes row for the client with its lines on quote_id', async () => {
    tables([{ id: 'client-1', name: 'Pat Smith ' }])
    const result = await useCreateQuoteFromBid()({ userId: 'user', clientName: 'pat smith', bid, jobType: 'Concrete', scope: 'Replace drive', recommendedPrice: 1000, section: 'Concrete' })
    expect(result).toMatchObject({ error: null, id: 'quote-1', clientId: 'client-1' })
    expect(mock.calls.some(c => c[0] === 'fh_contacts')).toBe(false)
    expect(mock.calls.some(c => c[0] === 'fh_clients' && c[1] === 'insert')).toBe(false)
    expect(mock.calls.find(c => c[0] === 'fh_quotes' && c[1] === 'insert')?.[2]).toMatchObject({
      user_id: 'user', client_id: 'client-1', status: 'draft', title: 'Driveway replacement', job_type: 'Concrete'
    })
    const items = mock.calls.find(c => c[0] === 'fh_quote_items' && c[1] === 'insert')?.[2]
    expect(items).toHaveLength(2)
    expect(items.every((i: any) => i.quote_id === 'quote-1' && i.contact_id === null)).toBe(true)
    expect(items.reduce((s: number, i: any) => s + i.amount, 0)).toBe(1000)
  })

  it('a new client name makes the client first', async () => {
    tables([])
    const result = await useCreateQuoteFromBid()({ userId: 'user', clientName: 'New Person', bid, jobType: '', scope: '', recommendedPrice: 500 })
    expect(result).toMatchObject({ error: null, id: 'quote-1', clientId: 'client-new' })
    expect(mock.calls.find(c => c[0] === 'fh_clients' && c[1] === 'insert')?.[2]).toMatchObject({ user_id: 'user', name: 'New Person' })
  })

  it('refuses without a client name and writes nothing', async () => {
    tables([])
    const result = await useCreateQuoteFromBid()({ userId: 'user', clientName: '  ', bid, jobType: '', scope: '', recommendedPrice: 500 })
    expect(result.error).toBeTruthy()
    expect(mock.calls).toEqual([])
  })
})

describe('native new lead', () => {
  function clients(existing: any[]) {
    mock.results.set('fh_clients', (_r: unknown, ops: any[]) => ops.some(o => o[0] === 'insert')
      ? { data: { id: 'client-new' }, error: null } : { data: existing, error: null })
    mock.results.set('fh_leads', { data: { id: 'lead-1' }, error: null })
  }

  it('keeps the typed job site address when the client already exists', async () => {
    clients([{ id: 'client-1', phone: '(555) 123-4567', email: null, address: '1 Home Rd' }])
    const result = await useCreateLead()({ userId: 'user', name: 'Pat', phone: '555 123 4567', address: '12 Oak St', notes: 'Back patio' })
    expect(result).toMatchObject({ error: null, id: 'lead-1', clientId: 'client-1' })
    const lead = mock.calls.find(c => c[0] === 'fh_leads' && c[1] === 'insert')?.[2]
    expect(lead).toMatchObject({ client_id: 'client-1', status: 'open' })
    expect(lead.notes).toContain('Job site: 12 Oak St')
    expect(lead.notes).toContain('Back patio')
  })

  it('a new client carries the address and the lead does not repeat it', async () => {
    clients([])
    const result = await useCreateLead()({ userId: 'user', name: 'New', address: '12 Oak St' })
    expect(result).toMatchObject({ error: null, id: 'lead-1', clientId: 'client-new' })
    expect(mock.calls.find(c => c[0] === 'fh_clients' && c[1] === 'insert')?.[2]).toMatchObject({ address: '12 Oak St' })
    expect(mock.calls.find(c => c[0] === 'fh_leads' && c[1] === 'insert')?.[2].notes ?? '').not.toContain('Job site')
  })
})

describe('native reminders', () => {
  for (const status of ['done', 'dismissed'] as const) {
    it(`${status} closes the follow up through fh_follow_up_set_status`, async () => {
      const result = await useSetFollowUpStatus()({ id: 'note-1', userId: 'user', status })
      expect(result.error).toBeNull()
      expect(mock.calls).toEqual([['rpc', 'fh_follow_up_set_status', { p_notification_id: 'note-1', p_status: status }]])
      expect(mock.invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'user'] })
    })
  }
  it('a refused follow up update is reported and nothing refreshes', async () => {
    mock.results.set('rpc:fh_follow_up_set_status', { data: null, error: new Error('not yours') })
    expect((await useSetFollowUpStatus()({ id: 'note-1', userId: 'user', status: 'done' })).error?.message).toBe('not yours')
    expect(mock.invalidate).not.toHaveBeenCalled()
  })
})

describe('native money visibility', () => {
  const rows = [
    { org_id: 'org-old', role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    { org_id: 'org-new', role: 'crew', joined_at: '2026-01-01T00:00:00Z' },
  ]
  it('loads the active membership and asks fh_money_visible for that org', async () => {
    mock.results.set('org_members', { data: rows, error: null })
    mock.results.set('rpc:fh_money_visible', { data: false, error: null })
    useMembership('user')
    expect(await mock.options.queryFn()).toEqual({ orgId: 'org-old', role: 'owner', moneyVisible: false })
    expect(mock.calls).toContainEqual(['org_members', 'eq', 'user_id', 'user'])
    expect(mock.calls).toContainEqual(['rpc', 'fh_money_visible', { p_org_id: 'org-old' }])
  })
  it('crew and foreman see no money', async () => {
    mock.results.set('org_members', { data: [rows[1]], error: null })
    mock.results.set('rpc:fh_money_visible', { data: false, error: null })
    useMembership('user')
    expect(await mock.options.queryFn()).toMatchObject({ role: 'crew', moneyVisible: false })
  })
  it('a person with no company yet sees their own money', async () => {
    mock.results.set('org_members', { data: [], error: null })
    useMembership('user')
    expect(await mock.options.queryFn()).toEqual({ orgId: null, role: null, moneyVisible: true })
    expect(mock.calls.some(c => c[0] === 'rpc')).toBe(false)
  })
  it('a failed check hides money rather than showing it', async () => {
    mock.results.set('org_members', { data: [rows[0]], error: null })
    mock.results.set('rpc:fh_money_visible', { data: null, error: new Error('offline') })
    useMembership('user')
    await expect(mock.options.queryFn()).rejects.toThrow('offline')
    expect(mock.options.throwOnError).toBe(false)
    expect(moneyVisible(undefined)).toBe(false)
    expect(moneyVisible({ orgId: 'org', role: 'owner', moneyVisible: true })).toBe(true)
  })
})
