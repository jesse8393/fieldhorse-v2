// src/screens/ContactDetail/sections/composeActivityEvents.ts
//
// Synthesizes a unified, chronological activity feed for one job from
// the raw arrays that useJobData already loads. NO new schema — the
// feed is computed at render time.
//
// Event shape (consumed by ActivityLog.jsx):
//   { id, when: Date, kind, title, sub?, tone? }
//     kind: 'created' | 'stage' | 'note' | 'payment' | 'schedule' |
//           'change_order' | 'change_order_approved'
//     tone: 'neutral' | 'gold' | 'green' | 'red'
//
// Sorted most-recent first; events at the exact same timestamp keep
// insertion order (kind precedence).

type ActivityEvent = {
  id: string
  when: Date
  kind: string
  title: string
  sub?: string | null
  tone?: string
}

function methodLabel(m: string | null | undefined) {
  if (!m) return 'Payment'
  const lower = String(m).toLowerCase()
  if (lower === 'ach') return 'ACH'
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function kindLabel(k: string | null | undefined) {
  if (!k || k === 'other') return ''
  const map: Record<string, string> = { deposit: 'deposit', progress: 'progress', final: 'final', retainage: 'retainage' }
  return map[k] || ''
}

function money(n: number | string | null | undefined) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  })
}

// Tone matrix for stage transitions. Closed = good (collected),
// lost = bad, everything else = gold-toned progress.
const STAGE_TONE: Record<string, string> = {
  closed: 'green',
  lost:   'red',
  invoice: 'gold',
  job:    'gold',
  quote:  'gold',
  lead:   'neutral'
}

export function composeActivityEvents({
  contact,
  notes = [],
  payments = [],
  scheduleItems = [],
  changeOrders = [],
  stageTransitions = []
}: {
  contact?: any
  notes?: any[]
  payments?: any[]
  scheduleItems?: any[]
  changeOrders?: any[]
  stageTransitions?: any[]
}): ActivityEvent[] {
  const out: ActivityEvent[] = []

  // 1. Job created — anchors the bottom of the feed
  if (contact?.created_at) {
    out.push({
      id: `created:${contact.id}`,
      when: new Date(contact.created_at),
      kind: 'created',
      title: 'Job created',
      sub: contact.referred_by ? `Referred by ${contact.referred_by}` : null,
      tone: 'neutral'
    })
  }

  // 2. Quote sent — single event from contact.quote_sent_at
  if (contact?.quote_sent_at) {
    out.push({
      id: `quote_sent:${contact.id}`,
      when: new Date(contact.quote_sent_at),
      kind: 'stage',
      title: 'Proposal sent to client',
      sub: contact.quote_expires_at
        ? `Valid until ${new Date(contact.quote_expires_at).toLocaleDateString()}`
        : null,
      tone: 'gold'
    })
  }

  // 3. Stage milestones — prefer the real fh_stage_transitions table
  //    (migration 023) when populated. Falls back to a synthetic "now
  //    at" marker for pre-migration contacts that have no history rows.
  if (stageTransitions && stageTransitions.length > 0) {
    for (const t of stageTransitions) {
      const tone = STAGE_TONE[t.to_stage] || 'gold'
      out.push({
        id: `stage_t:${t.id}`,
        when: new Date(t.transitioned_at),
        kind: 'stage',
        title: t.from_stage
          ? `${capitalize(t.from_stage)} → ${capitalize(t.to_stage)}`
          : `Created at ${capitalize(t.to_stage)}`,
        sub: null,
        tone
      })
    }
  } else if (contact?.stage && contact.stage !== 'lead') {
    // Legacy fallback for contacts created before migration 023
    out.push({
      id: `stage:${contact.id}:${contact.stage}`,
      when: new Date(contact.updated_at || contact.created_at),
      kind: 'stage',
      title: `Stage: ${capitalize(contact.stage)}`,
      sub: null,
      tone: STAGE_TONE[contact.stage] || 'gold'
    })
  }

  // 4. Payments
  for (const p of payments || []) {
    const kindStr = kindLabel(p.kind)
    out.push({
      id: `payment:${p.id}`,
      when: new Date(p.paid_on || p.created_at),
      kind: 'payment',
      title: `${money(p.amount)} received${kindStr ? ` · ${kindStr}` : ''}`,
      sub: [
        methodLabel(p.method),
        p.reference || null
      ].filter(Boolean).join(' · '),
      tone: 'green'
    })
  }

  // 5. Change orders — surface both creation + approval if the dates
  //    differ; same date collapses into a single "approved" event.
  for (const co of changeOrders || []) {
    out.push({
      id: `co:${co.id}`,
      when: new Date(co.created_at),
      kind: 'change_order',
      title: `CO #${co.sequence_number} added — ${co.title || 'Change order'}`,
      sub: `${co.amount >= 0 ? '+' : ''}${money(co.amount)}`,
      tone: 'neutral'
    })
    if (co.status === 'approved' && co.approved_at && co.approved_at !== co.created_at) {
      out.push({
        id: `co_approved:${co.id}`,
        when: new Date(co.approved_at),
        kind: 'change_order_approved',
        title: `CO #${co.sequence_number} approved`,
        sub: co.approved_by_name ? `Signed by ${co.approved_by_name}` : null,
        tone: 'green'
      })
    }
  }

  // 6. Schedule events — anchored to start_at so they read as
  //    "scheduled for" not "created on"
  for (const s of scheduleItems || []) {
    out.push({
      id: `sched:${s.id}`,
      when: new Date(s.start_at || s.created_at),
      kind: 'schedule',
      title: s.title || 'Scheduled event',
      sub: s.start_at
        ? new Date(s.start_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : null,
      tone: 'neutral'
    })
  }

  // 7. Notes — only the most recent 5 so the feed isn't dominated by
  //    a chatty job. Older notes live on the Notes screen.
  const sortedNotes = (notes || [])
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)
  for (const n of sortedNotes) {
    const preview = (n.text || '').trim().split('\n')[0].slice(0, 80)
    out.push({
      id: `note:${n.id}`,
      when: new Date(n.created_at),
      kind: 'note',
      title: 'Note added',
      sub: preview || '(empty note)',
      tone: 'neutral'
    })
  }

  // Most recent first; drop events with an invalid date
  return out
    .filter((e) => e.when instanceof Date && !Number.isNaN(e.when.getTime()))
    .sort((a, b) => b.when.getTime() - a.when.getTime())
}

function capitalize(s: string | null | undefined) {
  if (!s) return ''
  return s[0].toUpperCase() + s.slice(1)
}
