import { dueStatus } from '../../../lib/dueDate.ts'

export type JobNextActionKind = 'idle' | 'schedule' | 'milestone' | 'todo' | 'stage'

export type JobNextAction = {
  kind: JobNextActionKind
  title: string
  ctaLabel: string
  date?: string | null
  dueAt?: string | null
  sourceId?: string | number | null
  pipelineFn?: string
}

/**
 * Job Next Action — resolve "what should the operator do next?" via priority
 * chain (Q2 decision):
 *
 *   1. Next upcoming fh_schedule entry  (start_at >= now, soonest first)
 *   2. Next undone milestone            (contact.milestones[].done = false)
 *   3. Next undone fh_job_todos         (due-aware: overdue > today > soonest
 *                                         future > undated, undated preserves
 *                                         upstream created_at-newest-first order)
 *   4. Stage-driven default suggestion  (per pipeline stage)
 *
 * When chain item 4 fires, the suggestion's `pipelineFn` advances the stage
 * via the existing pipeline.ts cascade (markComplete, approveQuote, reopen,
 * etc.). This is how the v3 NextActionCard subsumes the legacy StageActions
 * row — same backend cascade, single primary action per screen.
 *
 * Pure function. Returns one of these shapes (always { kind, title, ctaLabel }
 * plus optional date/pipelineFn/sourceId/dueAt):
 *
 *   { kind: 'schedule',  title, date, ctaLabel: 'Mark Complete',  sourceId }
 *   { kind: 'milestone', title,       ctaLabel: 'Mark Complete',  sourceId: index }
 *   { kind: 'todo',      title, dueAt, ctaLabel: 'Mark Complete', sourceId }
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
const STAGE_DEFAULTS: Record<string, Pick<JobNextAction, 'title' | 'ctaLabel' | 'pipelineFn'>> = {
  lead:    { title: 'Send a quote.',                   ctaLabel: 'Convert to quote', pipelineFn: 'startQuote' },
  quote:   { title: 'Approve the quote and kick off.', ctaLabel: 'Approve quote',   pipelineFn: 'approveQuote' },
  job:     { title: 'Wrap up and invoice.',            ctaLabel: 'Mark complete',   pipelineFn: 'markComplete' },
  // Legacy alias of 'job' (pipeline v2 retired the invoice stage).
  invoice: { title: 'Collect the balance.',            ctaLabel: 'Send invoice',    pipelineFn: 'sendInvoice' },
  closed:  { title: 'Job done. Reopen if needed.',     ctaLabel: 'Reopen',          pipelineFn: 'reopen' },
  lost:    { title: 'Reopen if back in play.',         ctaLabel: 'Reopen',          pipelineFn: 'reopen' }
}

// Job-stage default, work already marked complete: the next move is
// collecting the money, not completing again.
const JOB_COMPLETED_DEFAULT: Pick<JobNextAction, 'title' | 'ctaLabel' | 'pipelineFn'> = {
  title: 'Work’s done — collect the balance.',
  ctaLabel: 'Send invoice',
  pipelineFn: 'sendInvoice'
}

function normalizeStage(stage: any) {
  return String(stage || 'lead').toLowerCase()
}

export function resolvePipelineAction(contact: any): JobNextAction | null {
  if (!contact) return null
  const stage = normalizeStage(contact.stage)
  const fallback = (stage === 'job' && contact.completed_at)
    ? JOB_COMPLETED_DEFAULT
    : STAGE_DEFAULTS[stage] || STAGE_DEFAULTS.lead
  return {
    kind: 'stage',
    title: fallback.title,
    ctaLabel: fallback.ctaLabel,
    pipelineFn: fallback.pipelineFn
  }
}

export function resolvePrimaryAction(args: { contact?: any; scheduleItems?: any[]; todos?: any[] } = {}): JobNextAction {
  const contact = args.contact
  if (!contact) {
    return { kind: 'idle', title: 'No next action.', ctaLabel: '+ Schedule next step' }
  }

  const stage = normalizeStage(contact.stage)
  const pipelineAction = resolvePipelineAction(contact)
  const shouldPrioritizePipeline =
    stage === 'lead'
    || stage === 'quote'
    || stage === 'invoice'
    || stage === 'closed'
    || stage === 'lost'
    || (stage === 'job' && !!contact.completed_at)

  return shouldPrioritizePipeline && pipelineAction
    ? pipelineAction
    : resolveNextAction(args)
}

export function resolveNextAction({ contact, scheduleItems = [], todos = [] }: { contact?: any; scheduleItems?: any[]; todos?: any[] } = {}): JobNextAction {
  if (!contact) {
    return { kind: 'idle', title: 'No next action.', ctaLabel: '+ Schedule next step' }
  }

  const now = Date.now()

  // 1. SCHEDULE — soonest upcoming entry wins
  const upcoming = scheduleItems
    .filter((s) => s?.start_at && new Date(s.start_at).getTime() >= now)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0]

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
  const milestoneIdx = milestones.findIndex((m: any) => m && !m.done)
  if (milestoneIdx !== -1) {
    return {
      kind: 'milestone',
      title: milestones[milestoneIdx].label || 'Next milestone',
      ctaLabel: 'Mark Complete',
      sourceId: milestoneIdx
    }
  }

  // 3. TODOS — due-aware selection (migration 010 added due_at). Inside
  // the todos branch we rank: overdue (oldest first) > today > soonest
  // future > undated. Undated rows fall back to upstream array order
  // (TodosTab fetches done ASC, created_at DESC), preserving the prior
  // "newest pending" behavior for operators not using deadlines.
  const nextTodo = pickPriorityTodo(todos)
  if (nextTodo) {
    return {
      kind: 'todo',
      title: nextTodo.text || 'Next to-do',
      dueAt: nextTodo.due_at || null,
      ctaLabel: 'Mark Complete',
      sourceId: nextTodo.id
    }
  }

  // 4. STAGE DEFAULT — falls back to a sensible "what does this stage need?"
  return resolvePipelineAction(contact) || { kind: 'idle', title: 'No next action.', ctaLabel: '+ Schedule next step' }
}

// Bucket undone todos by dueStatus tone, then sort by due_at ascending
// within each bucket. danger (overdue, oldest first) > warn (today)
// > muted (soonest future) > undated (preserves upstream order).
const TODO_BUCKET_RANK: Record<string, number> = { danger: 0, warn: 1, muted: 2 }

function pickPriorityTodo(todos: any[]) {
  if (!Array.isArray(todos) || todos.length === 0) return null
  let firstUndated: any = null
  const dated: any[] = []
  for (const t of todos) {
    if (!t || t.done) continue
    if (t.due_at) {
      dated.push(t)
    } else if (!firstUndated) {
      firstUndated = t
    }
  }
  if (dated.length === 0) return firstUndated
  dated.sort((a, b) => {
    const ra = TODO_BUCKET_RANK[dueStatus(a.due_at)?.tone ?? ''] ?? 3
    const rb = TODO_BUCKET_RANK[dueStatus(b.due_at)?.tone ?? ''] ?? 3
    if (ra !== rb) return ra - rb
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  })
  return dated[0]
}
