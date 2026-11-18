// Demo data seed, Phase 19 / Audit Move #2.
//
// Inserts a realistic-looking starter dataset for a brand-new account so
// the user immediately sees the app's full surface (clients, a lead, a
// quote with its lines, jobs, today's schedule, AI-parsed notes, todos,
// expenses) instead of an empty Home with em-dashes.
//
// Each sample lands where its screen reads it: the lead on fh_leads, the
// quote on fh_quotes with its lines on fh_quote_items, and jobs on
// fh_contacts at stage job or closed. fh_contacts never gets a lead or
// quote stage row; no screen shows those any more.
//
// Every row is stamped with the caller's user_id and the org being
// seeded, and the seed refuses to run unless the caller OWNS that org:
// an invited teammate must never drop fake clients and jobs (with
// contract amounts that feed the pipeline) into the employer's book.
// Sample clients and jobs carry source 'demo'. The lead and the quote
// belong to sample clients, which is how removeDemoData (Settings,
// Remove sample data) finds them: fh_leads.source is the referral source
// and fh_quotes has no source.
//
// Usage:
//   import { seedDemoData } from '../lib/demoSeed.ts'
//   const counts = await seedDemoData(supabase, user.id, orgId)
//   // counts: { clients, leads, quotes, jobs, events, notes, todos, expenses }
//
// Returns counts; throws on any insert error.

import { hapticSuccess } from './haptics.ts'

function todayAt(hour: number, minute = 0) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
function dayAt(daysOffset: number, hour: number, minute = 0) {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}
function dateIn(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function seedDemoData(supabase: any, userId: string | undefined, orgId: string | null | undefined) {
  if (!userId) throw new Error('seedDemoData: userId required')
  if (!orgId) throw new Error('seedDemoData: orgId required')

  const { data: membership, error: membershipErr } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle()
  if (membershipErr) throw membershipErr
  if (membership?.role !== 'owner') {
    throw new Error('Sample data can only be added to a workspace you own.')
  }

  const counts = { clients: 0, leads: 0, quotes: 0, jobs: 0, events: 0, notes: 0, todos: 0, expenses: 0 }

  // ============================================================
  // 1. CLIENTS, 3 distinct
  // ============================================================
  const { data: clients, error: clientsErr } = await supabase
    .from('fh_clients')
    .insert([
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        name: 'Henderson Family',
        company_name: null,
        phone: '615-555-0142',
        email: 'henderson.family@example.com',
        address: '142 Maple Ridge Dr',
        notes: 'Repeat client. Quality focused, ok with longer timelines for the right finish.'
      },
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        name: 'McCarthy Construction LLC',
        company_name: 'McCarthy Construction',
        phone: '615-555-0288',
        email: 'ops@mccarthyconstruction.example',
        address: '8800 Industrial Pkwy, Suite 4',
        notes: 'GC subcontractor relationship. Pays Net 15. Always wants final walkthrough docs the same day.'
      },
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        name: 'Jane Patel',
        company_name: null,
        phone: '615-555-0334',
        email: 'jane.patel@example.com',
        address: '512 Oakdale Ln',
        notes: 'New referral from the Henderson job. Budget conscious; flag any creep early.'
      }
    ])
    .select('id, name')
  if (clientsErr) throw clientsErr
  counts.clients = clients.length
  const henderson = clients.find((c: any) => c.name === 'Henderson Family')
  const mccarthy = clients.find((c: any) => c.name === 'McCarthy Construction LLC')
  const patel = clients.find((c: any) => c.name === 'Jane Patel')

  // ============================================================
  // 2. LEAD (fh_leads) and QUOTE (fh_quotes with its lines)
  // ============================================================
  const { data: leads, error: leadsErr } = await supabase
    .from('fh_leads')
    .insert([
      {
        user_id: userId,
        org_id: orgId,
        client_id: patel.id,
        title: 'Front yard redesign',
        job_type: 'Outdoor Living',
        source: 'Referral',
        referred_by: 'Henderson Family',
        status: 'open',
        follow_up_on: dateIn(2),
        notes: 'First call. Likes the look of the Henderson driveway. Wants a quote by Friday.'
      }
    ])
    .select('id, title')
  if (leadsErr) throw leadsErr
  counts.leads = leads.length
  const patelYard = leads[0]

  const bathLines = [
    { section: 'Labor', description: 'Demo existing tile and haul away', qty: 1, unit: 'lot', rate: 2400 },
    { section: 'Materials', description: 'Porcelain tile, shower walls and floor', qty: 120, unit: 'sf', rate: 35 },
    { section: 'Labor', description: 'Tile install, shower and floor', qty: 120, unit: 'sf', rate: 45 },
    { section: 'Materials', description: 'Vanity, faucet and fixtures', qty: 1, unit: 'lot', rate: 6000 }
  ].map((line) => ({ ...line, amount: line.qty * line.rate }))
  const { data: quotes, error: quotesErr } = await supabase
    .from('fh_quotes')
    .insert([
      {
        user_id: userId,
        org_id: orgId,
        client_id: henderson.id,
        title: 'Primary bath refresh',
        job_type: 'Bath',
        scope_text: 'Tear out and retile the primary shower and floor. New vanity, faucet and fixtures.',
        amount: bathLines.reduce((sum, line) => sum + line.amount, 0),
        status: 'sent',
        sent_at: daysAgo(3)
      }
    ])
    .select('id, title, amount')
  if (quotesErr) throw quotesErr
  counts.quotes = quotes.length
  const henBath = quotes[0]
  const { error: linesErr } = await supabase
    .from('fh_quote_items')
    .insert(bathLines.map((line, i) => ({
      user_id: userId,
      org_id: orgId,
      quote_id: henBath.id,
      contact_id: null,
      sort_order: i,
      ...line
    })))
    .select('id')
  if (linesErr) throw linesErr

  // ============================================================
  // 3. JOBS (fh_contacts), 4: three in progress or done, one closed
  // ============================================================
  const { data: jobs, error: jobsErr } = await supabase
    .from('fh_contacts')
    .insert([
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        client_id: henderson.id,
        name: 'Henderson Family',
        phone: '615-555-0142',
        email: 'henderson.family@example.com',
        address: '142 Maple Ridge Dr',
        job_title: 'Kitchen remodel, full gut',
        job_type: 'Kitchen',
        amount: 42000,
        cost: 24500,
        stage: 'job',
        notes: 'Cabinets ordered. Counters next week. Backsplash TBD pending homeowner pick.'
      },
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        client_id: mccarthy.id,
        name: 'McCarthy office build out',
        phone: '615-555-0288',
        email: 'ops@mccarthyconstruction.example',
        address: '8800 Industrial Pkwy, Suite 4',
        job_title: 'Office tenant build out',
        job_type: 'Renovation',
        amount: 87000,
        cost: 54200,
        stage: 'job',
        completed_at: new Date().toISOString(),
        notes: 'Final walkthrough complete. Invoice sent. Net 15 expected by 5/9.'
      },
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        client_id: null,
        name: 'Davis driveway',
        phone: '615-555-0871',
        email: null,
        address: '24 Hillcrest Rd',
        job_title: 'Driveway pour + apron',
        job_type: 'Concrete',
        amount: 12000,
        cost: 7800,
        stage: 'closed',
        notes: 'Closed 2 weeks ago. Paid in full. Davis already referred a neighbor.'
      },
      {
        user_id: userId,
        org_id: orgId,
        source: 'demo',
        client_id: null,
        name: 'Murray garage addition',
        phone: '615-555-0617',
        email: 'rmurray@example.com',
        address: '901 Westbrook Ave',
        job_title: 'Detached 2-car garage',
        job_type: 'New Construction',
        amount: 54000,
        cost: 31200,
        stage: 'job',
        notes: 'Foundation complete. Framing scheduled this week.'
      }
    ])
    .select('id, name, job_title, stage, client_id')
  if (jobsErr) throw jobsErr
  counts.jobs = jobs.length
  const henKitchen = jobs.find((j: any) => j.job_title === 'Kitchen remodel, full gut')
  const mccOffice = jobs.find((j: any) => j.job_title === 'Office tenant build out')
  const murray = jobs.find((j: any) => j.job_title === 'Detached 2-car garage')

  // ============================================================
  // 4. SCHEDULE, 4 events in the next 7 days
  // ============================================================
  const { data: events, error: eventsErr } = await supabase
    .from('fh_schedule')
    .insert([
      { user_id: userId, org_id: orgId, contact_id: henKitchen.id, title: 'Site visit for counter template', start_at: todayAt(9, 0) },
      { user_id: userId, org_id: orgId, contact_id: murray.id,    title: 'Concrete pour, slab',           start_at: todayAt(13, 0) },
      { user_id: userId, org_id: orgId, contact_id: mccOffice.id, title: 'Final walkthrough w/ client',    start_at: dayAt(1, 8, 30) },
      { user_id: userId, org_id: orgId, lead_id: patelYard.id,    title: 'Quote review on site',           start_at: dayAt(3, 10, 0) }
    ])
    .select('id')
  if (eventsErr) throw eventsErr
  counts.events = events.length

  // ============================================================
  // 5. NOTES, 3, one with parsed AI structure
  // ============================================================
  const { data: notes, error: notesErr } = await supabase
    .from('fh_notes')
    .insert([
      {
        user_id: userId,
        org_id: orgId,
        contact_id: henKitchen.id,
        text: 'Called Henderson. Going with quartz over the granite option. Reorder counters Monday.',
        category: 'note'
      },
      {
        user_id: userId,
        org_id: orgId,
        contact_id: murray.id,
        text: 'Need shingles ordered by Friday or framing slips a week. Owner ok with the upgrade if it adds <$400.',
        category: 'note',
        parsed: {
          summary: 'Order shingles by Friday or framing slips one week.',
          action_items: ['Order shingles by Friday', 'Confirm $400 cap with owner'],
          risks: ['Framing crew sits idle if material misses Friday'],
          materials_needed: ['Architectural shingles', 'Underlayment'],
          follow_up_date: dayAt(2, 17, 0).slice(0, 10)
        }
      },
      {
        user_id: userId,
        org_id: orgId,
        lead_id: patelYard.id,
        text: 'Patel mentioned budget around 10K, watch creep. She loved the Henderson driveway look.',
        category: 'note'
      }
    ])
    .select('id')
  if (notesErr) {
    // fh_notes.parsed column is optional (migration 003). Retry without it
    // so the seed doesn't fail on accounts that haven't run the migration.
    if (String(notesErr.message || '').toLowerCase().includes('parsed')) {
      const { data: notes2, error: notes2Err } = await supabase
        .from('fh_notes')
        .insert([
          { user_id: userId, org_id: orgId, contact_id: henKitchen.id, text: 'Called Henderson. Going with quartz over the granite option. Reorder counters Monday.', category: 'note' },
          { user_id: userId, org_id: orgId, contact_id: murray.id, text: 'Need shingles ordered by Friday or framing slips a week. Owner ok with the upgrade if it adds <$400.', category: 'note' },
          { user_id: userId, org_id: orgId, lead_id: patelYard.id, text: 'Patel mentioned budget around 10K, watch creep. She loved the Henderson driveway look.', category: 'note' }
        ])
        .select('id')
      if (notes2Err) throw notes2Err
      counts.notes = notes2.length
    } else {
      throw notesErr
    }
  } else {
    counts.notes = notes.length
  }

  // ============================================================
  // 6. JOB TODOS, 5 on Henderson kitchen, mixed done/not
  // ============================================================
  const { data: todos, error: todosErr } = await supabase
    .from('fh_job_todos')
    .insert([
      { user_id: userId, org_id: orgId, job_id: henKitchen.id, text: 'Order cabinets',                          done: true,  completed_at: daysAgo(8) },
      { user_id: userId, org_id: orgId, job_id: henKitchen.id, text: 'Demo old appliances',                     done: true,  completed_at: daysAgo(6) },
      { user_id: userId, org_id: orgId, job_id: henKitchen.id, text: 'Get plumbing rough in inspection booked', done: false },
      { user_id: userId, org_id: orgId, job_id: henKitchen.id, text: 'Confirm tile pick with homeowner',         done: false },
      { user_id: userId, org_id: orgId, job_id: henKitchen.id, text: 'Schedule electrician for week of 5/5',     done: false }
    ])
    .select('id')
  if (todosErr) {
    // fh_job_todos was added in migration 006. If absent, skip silently.
    if (!String(todosErr.message || '').toLowerCase().includes('does not exist')) throw todosErr
  } else {
    counts.todos = todos.length
  }

  // ============================================================
  // 7. EXPENSES, a few on the McCarthy job for margin realism
  // ============================================================
  const { data: expenses, error: expensesErr } = await supabase
    .from('fh_expenses')
    .insert([
      { user_id: userId, org_id: orgId, contact_id: mccOffice.id, description: 'Drywall + mud',  amount: 3850, category: 'Materials', expense_date: daysAgo(14) },
      { user_id: userId, org_id: orgId, contact_id: mccOffice.id, description: 'Subfloor pad',   amount: 1200, category: 'Materials', expense_date: daysAgo(12) },
      { user_id: userId, org_id: orgId, contact_id: mccOffice.id, description: 'Permit fee',     amount: 480,  category: 'Permits',   expense_date: daysAgo(20) },
      { user_id: userId, org_id: orgId, contact_id: henKitchen.id, description: 'Cabinet deposit', amount: 7400, category: 'Materials', expense_date: daysAgo(5) }
    ])
    .select('id')
  if (expensesErr) throw expensesErr
  counts.expenses = expenses.length

  hapticSuccess()
  return counts
}

// Child tables the seed writes against a sample job, with the column that
// points back at it. fh_job_todos keys on job_id (migration 006); the
// others on contact_id. The wrong column would delete nothing.
const DEMO_JOB_CHILDREN: { table: string; fk: string }[] = [
  { table: 'fh_expenses',  fk: 'contact_id' },
  { table: 'fh_schedule',  fk: 'contact_id' },
  { table: 'fh_notes',     fk: 'contact_id' },
  { table: 'fh_job_todos', fk: 'job_id' }
]

// Settings, Remove sample data. Finds the sample clients and jobs by
// source 'demo', and the sample leads and quotes by their sample client.
// Children go first, then the records, then the clients, each delete
// scoped to this user, so it can never touch real work. Visits and notes
// on a lead or quote would only lose their link if the lead or quote went
// first, so they are deleted by that link. Returns how many rows it
// removed; throws on the first failed read or delete.
export async function removeDemoData(supabase: any, userId: string): Promise<number> {
  const ids = async (table: string, scope: (q: any) => any): Promise<string[]> => {
    const { data, error } = await scope(supabase.from(table).select('id').eq('user_id', userId))
    if (error) throw new Error(error.message)
    return (data || []).map((r: any) => r.id)
  }
  const clientIds = await ids('fh_clients', (q) => q.eq('source', 'demo'))
  const jobIds = await ids('fh_contacts', (q) => q.eq('source', 'demo'))
  const leadIds = clientIds.length ? await ids('fh_leads', (q) => q.in('client_id', clientIds)) : []
  const quoteIds = clientIds.length ? await ids('fh_quotes', (q) => q.in('client_id', clientIds)) : []

  let total = 0
  // Child tables name themselves in a failure. The jobs delete passes the
  // bare message through, as it always has: that wording is shown in
  // Settings and belongs to the errors lane.
  const remove = async (table: string, column: string, values: string[], named = true) => {
    if (!values.length) return
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .in(column, values)
    // Surface a real failure instead of quietly under-counting.
    if (error) throw new Error(named ? `${table}: ${error.message}` : error.message)
    total += count ?? 0
  }

  for (const { table, fk } of DEMO_JOB_CHILDREN) await remove(table, fk, jobIds)
  for (const table of ['fh_schedule', 'fh_notes']) {
    await remove(table, 'lead_id', leadIds)
    await remove(table, 'quote_id', quoteIds)
  }
  await remove('fh_quote_items', 'quote_id', quoteIds)
  await remove('fh_quotes', 'id', quoteIds)
  await remove('fh_leads', 'id', leadIds)
  await remove('fh_contacts', 'id', jobIds, false)
  const { error: clientsErr, count: clientsCount } = await supabase
    .from('fh_clients')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('source', 'demo')
  if (clientsErr) throw new Error(clientsErr.message)
  return total + (clientsCount ?? 0)
}
