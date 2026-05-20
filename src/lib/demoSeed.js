// Demo data seed — Phase 19 / Audit Move #2.
//
// Inserts a realistic-looking starter dataset for a brand-new account so
// the user immediately sees the app's full surface (clients, jobs across
// every pipeline stage, today's schedule, AI-parsed notes, todos,
// expenses) instead of an empty Home with em-dashes.
//
// All inserts are RLS-scoped to the caller's user_id. Settings → "Reset
// everything" wipes them.
//
// Usage:
//   import { seedDemoData } from '../lib/demoSeed.js'
//   const counts = await seedDemoData(supabase, user.id)
//   // counts: { clients, jobs, events, notes, todos, expenses }
//
// Returns counts; throws on any insert error.

import { hapticSuccess } from './haptics.ts'

function todayAt(hour, minute = 0) {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
function dayAt(daysOffset, hour, minute = 0) {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

export async function seedDemoData(supabase, userId) {
  if (!userId) throw new Error('seedDemoData: userId required')

  const counts = { clients: 0, jobs: 0, events: 0, notes: 0, todos: 0, expenses: 0 }

  // ============================================================
  // 1. CLIENTS — 3 distinct
  // ============================================================
  const { data: clients, error: clientsErr } = await supabase
    .from('fh_clients')
    .insert([
      {
        user_id: userId,
        name: 'Henderson Family',
        company_name: null,
        phone: '615-555-0142',
        email: 'henderson.family@example.com',
        address: '142 Maple Ridge Dr',
        notes: 'Repeat client. Quality-focused, ok with longer timelines for the right finish.'
      },
      {
        user_id: userId,
        name: 'McCarthy Construction LLC',
        company_name: 'McCarthy Construction',
        phone: '615-555-0288',
        email: 'ops@mccarthyconstruction.example',
        address: '8800 Industrial Pkwy, Suite 4',
        notes: 'GC sub-relationship. Pays NET-15. Always wants final walkthrough docs the same day.'
      },
      {
        user_id: userId,
        name: 'Jane Patel',
        company_name: null,
        phone: '615-555-0334',
        email: 'jane.patel@example.com',
        address: '512 Oakdale Ln',
        notes: 'New referral from the Henderson job. Budget-conscious; flag any creep early.'
      }
    ])
    .select('id, name')
  if (clientsErr) throw clientsErr
  counts.clients = clients.length
  const henderson = clients.find((c) => c.name === 'Henderson Family')
  const mccarthy = clients.find((c) => c.name === 'McCarthy Construction LLC')
  const patel = clients.find((c) => c.name === 'Jane Patel')

  // ============================================================
  // 2. JOBS (fh_contacts) — 6 across every stage
  // ============================================================
  const { data: jobs, error: jobsErr } = await supabase
    .from('fh_contacts')
    .insert([
      {
        user_id: userId,
        client_id: henderson.id,
        name: 'Henderson Family',
        phone: '615-555-0142',
        email: 'henderson.family@example.com',
        address: '142 Maple Ridge Dr',
        job_title: 'Kitchen remodel — full gut',
        job_type: 'Kitchen',
        amount: 42000,
        cost: 24500,
        stage: 'job',
        notes: 'Cabinets ordered. Counters next week. Backsplash TBD pending homeowner pick.'
      },
      {
        user_id: userId,
        client_id: henderson.id,
        name: 'Henderson Family',
        phone: '615-555-0142',
        email: 'henderson.family@example.com',
        address: '142 Maple Ridge Dr',
        job_title: 'Primary bath refresh',
        job_type: 'Bath',
        amount: 18000,
        cost: 0,
        stage: 'quote',
        notes: 'Quote sent 4/22. Awaiting decision on tile vs slab shower wall.'
      },
      {
        user_id: userId,
        client_id: mccarthy.id,
        name: 'McCarthy office build-out',
        phone: '615-555-0288',
        email: 'ops@mccarthyconstruction.example',
        address: '8800 Industrial Pkwy, Suite 4',
        job_title: 'Office tenant build-out',
        job_type: 'Renovation',
        amount: 87000,
        cost: 54200,
        stage: 'invoice',
        notes: 'Final walkthrough complete. Invoice sent. NET-15 expected by 5/9.'
      },
      {
        user_id: userId,
        client_id: patel.id,
        name: 'Jane Patel',
        phone: '615-555-0334',
        email: 'jane.patel@example.com',
        address: '512 Oakdale Ln',
        job_title: 'Front yard redesign',
        job_type: 'Outdoor Living',
        amount: 9500,
        cost: 0,
        stage: 'lead',
        notes: 'First call. Likes the look of the Henderson driveway. Wants a quote by Friday.'
      },
      {
        user_id: userId,
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
  const henKitchen = jobs.find((j) => j.job_title === 'Kitchen remodel — full gut')
  const henBath = jobs.find((j) => j.job_title === 'Primary bath refresh')
  const mccOffice = jobs.find((j) => j.job_title === 'Office tenant build-out')
  const patelYard = jobs.find((j) => j.job_title === 'Front yard redesign')
  const murray = jobs.find((j) => j.job_title === 'Detached 2-car garage')

  // ============================================================
  // 3. SCHEDULE — 4 events in the next 7 days
  // ============================================================
  const { data: events, error: eventsErr } = await supabase
    .from('fh_schedule')
    .insert([
      { user_id: userId, contact_id: henKitchen.id, title: 'Site visit — counter template', start_at: todayAt(9, 0) },
      { user_id: userId, contact_id: murray.id,    title: 'Concrete pour — slab',           start_at: todayAt(13, 0) },
      { user_id: userId, contact_id: mccOffice.id, title: 'Final walkthrough w/ client',    start_at: dayAt(1, 8, 30) },
      { user_id: userId, contact_id: patelYard.id, title: 'On-site quote review',           start_at: dayAt(3, 10, 0) }
    ])
    .select('id')
  if (eventsErr) throw eventsErr
  counts.events = events.length

  // ============================================================
  // 4. NOTES — 3, one with parsed AI structure
  // ============================================================
  const { data: notes, error: notesErr } = await supabase
    .from('fh_notes')
    .insert([
      {
        user_id: userId,
        contact_id: henKitchen.id,
        text: 'Called Henderson — going with quartz over the granite option. Reorder counters Monday.',
        category: 'note'
      },
      {
        user_id: userId,
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
        contact_id: patelYard.id,
        text: 'Patel mentioned budget around 10K — watch creep. She loved the Henderson driveway look.',
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
          { user_id: userId, contact_id: henKitchen.id, text: 'Called Henderson — going with quartz over the granite option. Reorder counters Monday.', category: 'note' },
          { user_id: userId, contact_id: murray.id, text: 'Need shingles ordered by Friday or framing slips a week. Owner ok with the upgrade if it adds <$400.', category: 'note' },
          { user_id: userId, contact_id: patelYard.id, text: 'Patel mentioned budget around 10K — watch creep. She loved the Henderson driveway look.', category: 'note' }
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
  // 5. JOB TODOS — 5 on Henderson kitchen, mixed done/not
  // ============================================================
  const { data: todos, error: todosErr } = await supabase
    .from('fh_job_todos')
    .insert([
      { user_id: userId, job_id: henKitchen.id, text: 'Order cabinets',                          done: true,  completed_at: daysAgo(8) },
      { user_id: userId, job_id: henKitchen.id, text: 'Demo old appliances',                     done: true,  completed_at: daysAgo(6) },
      { user_id: userId, job_id: henKitchen.id, text: 'Get plumbing rough-in inspection booked', done: false },
      { user_id: userId, job_id: henKitchen.id, text: 'Confirm tile pick with homeowner',         done: false },
      { user_id: userId, job_id: henKitchen.id, text: 'Schedule electrician for week of 5/5',     done: false }
    ])
    .select('id')
  if (todosErr) {
    // fh_job_todos was added in migration 006. If absent, skip silently.
    if (!String(todosErr.message || '').toLowerCase().includes('does not exist')) throw todosErr
  } else {
    counts.todos = todos.length
  }

  // ============================================================
  // 6. EXPENSES — a few on the McCarthy job for margin realism
  // ============================================================
  const { data: expenses, error: expensesErr } = await supabase
    .from('fh_expenses')
    .insert([
      { user_id: userId, contact_id: mccOffice.id, description: 'Drywall + mud',  amount: 3850, category: 'Materials', expense_date: daysAgo(14) },
      { user_id: userId, contact_id: mccOffice.id, description: 'Subfloor pad',   amount: 1200, category: 'Materials', expense_date: daysAgo(12) },
      { user_id: userId, contact_id: mccOffice.id, description: 'Permit fee',     amount: 480,  category: 'Permits',   expense_date: daysAgo(20) },
      { user_id: userId, contact_id: henKitchen.id, description: 'Cabinet deposit', amount: 7400, category: 'Materials', expense_date: daysAgo(5) }
    ])
    .select('id')
  if (expensesErr) throw expensesErr
  counts.expenses = expenses.length

  hapticSuccess()
  return counts
}
