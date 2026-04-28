/**
 * Job Next Action — resolve "what should the operator do next?" via priority
 * chain (Q2 decision):
 *
 *   1. Next upcoming fh_schedule entry  (start_at >= now, soonest first)
 *   2. Next undone milestone            (contact.milestones[].done = false)
 *   3. Next undone fh_job_todos         (todos.done = false, oldest first
 *                                         — todos table has no due_at column
 *                                         per current schema, so we fall back
 *                                         to created_at order)
 *   4. Stage-driven default suggestion  (per pipeline stage)
 *
 * When chain item 4 fires, the suggestion's `pipelineFn` advances the stage
 * via the existing pipeline.js cascade (markComplete, approveQuote, reopen,
 * etc.). This is how the v3 NextActionCard subsumes the legacy StageActions
 * row — same backend cascade, single primary action per screen.
 *
 * Pure function. Returns one of these shapes (always { kind, title, ctaLabel }
 * plus optional date/pipelineFn/sourceId):
 *
 *   { kind: 'schedule',  title, date, ctaLabel: 'Mark Complete',  sourceId }
 *   { kind: 'milestone', title,       ctaLabel: 'Mark Complete',  sourceId: index }
 *   { kind: 'todo',      title,       ctaLabel: 'Mark Complete',  sourceId }
 *   { kind: 'stage',     title,       ctaLabel: <stage cta>,      pipelineFn }
 *   { kind: 'idle',      title: 'No next action.', ctaLabel: '+ Schedule next step' }
 *
 * The parent shell wires `onComplete` based on `kind`:
 *   - schedule  → mark fh_schedule entry done OR delete (TBD; for now: open AddEvent)
 *   - milestone → patch contact.milestones[i].done = true (existing pattern)
 *   - todo      → fh_job_todos UPDATE done=true, completed_at=now()
 *   - stage     → call pipelineFn(contact)
 *   - idle      → open AddEventSheet
 */
const STAGE_DEFAULTS = {
  lead:    { title: 'Send a quote.',                   ctaLabel: 'Start quote',     pipelineFn: 'startQuote' },
  quote:   { title: 'Approve the quote and kick off.', ctaLabel: 'Approve quote',   pipelineFn: 'approveQuote' },
  job:     { title: 'Wrap up and invoice.',            ctaLabel: 'Mark complete',   pipelineFn: 'markComplete' },
  invoice: { title: 'Log final payment.',              ctaLabel: 'Log payment',     pipelineFn: 'logPayment' },
  closed:  { title: 'Job done. Reopen if needed.',     ctaLabel: 'Reopen',          pipelineFn: 'reopen' },
  lost:    { title: 'Reopen if back in play.',         ctaLabel: 'Reopen',          pipelineFn: 'reopen' }
}

export function resolveNextAction({ contact, scheduleItems = [], todos = [] } = {}) {
  if (!contact) {
    return { kind: 'idle', title: 'No next action.', ctaLabel: '+ Schedule next step' }
  }

  const now = Date.now()

  // 1. SCHEDULE — soonest upcoming entry wins
  const upcoming = scheduleItems
    .filter((s) => s?.start_at && new Date(s.start_at).getTime() >= now)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0]

  if (upcoming) {
    return {
      kind: 'schedule',
      title: upcoming.title || 'Scheduled work',
      date: upcoming.start_at,
      ctaLabel: 'Mark Complete',
      sourceId: upcoming.id
    }
  }

  // 2. MILESTONES — first undone (operator-defined order matters; don't sort)
  const milestones = Array.isArray(contact.milestones) ? contact.milestones : []
  const milestoneIdx = milestones.findIndex((m) => m && !m.done)
  if (milestoneIdx !== -1) {
    return {
      kind: 'milestone',
      title: milestones[milestoneIdx].label || 'Next milestone',
      ctaLabel: 'Mark Complete',
      sourceId: milestoneIdx
    }
  }

  // 3. TODOS — first undone. Schema has no due_at; rely on natural order
  // (TodosTab sorts done ASC, created_at DESC, so the first undone in the
  // array is "newest pending", which is what an operator typically thinks
  // of as "what I added most recently").
  const nextTodo = todos.find((t) => t && !t.done)
  if (nextTodo) {
    return {
      kind: 'todo',
      title: nextTodo.title || nextTodo.label || 'Next to-do',
      ctaLabel: 'Mark Complete',
      sourceId: nextTodo.id
    }
  }

  // 4. STAGE DEFAULT — falls back to a sensible "what does this stage need?"
  const stage = contact.stage || 'lead'
  const fallback = STAGE_DEFAULTS[stage] || STAGE_DEFAULTS.lead
  return {
    kind: 'stage',
    title: fallback.title,
    ctaLabel: fallback.ctaLabel,
    pipelineFn: fallback.pipelineFn
  }
}
