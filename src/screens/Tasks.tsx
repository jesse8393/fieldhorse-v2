// Tasks — /tasks. Cross-job task dashboard for owners / admins /
// managers. Lists every open fh_job_todos row in the caller's org,
// grouped by urgency:
//
//   Overdue       due_at < today
//   Due today     due_at = today
//   Upcoming      due_at > today
//   No due date
//
// Within each bucket, rows are ordered by assignee then created_at.
//
// RLS on fh_job_todos is already org-scoped (auth_user_org_ids() per
// migration 034) so this screen reads directly without an edge
// function. Members write/update through the same policy. Hiding the
// route from foreman/crew is the only role gate — they see their own
// open tasks on /crew, which is the right surface for those roles.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Bell, Calendar, Check, ChevronRight, Clock, Search, UserRound, Trash2, Plus,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { orgMembersList, type OrgMember } from '../lib/orgApi.ts'
import { toastError, toastSuccess, toastUndo } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'

type TaskRow = {
  id: string
  text: string
  job_id: string
  assigned_to: string | null
  user_id: string
  due_at: string | null
  done: boolean
  completed_at: string | null
  created_at: string
}

type Bucket = 'overdue' | 'today' | 'upcoming' | 'none'

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfToday(): Date {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function bucketFor(dueAt: string | null): Bucket {
  if (!dueAt) return 'none'
  const t = new Date(dueAt).getTime()
  if (!Number.isFinite(t)) return 'none'
  if (t < startOfToday().getTime()) return 'overdue'
  if (t <= endOfToday().getTime()) return 'today'
  return 'upcoming'
}

function fmtDue(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const sod = startOfToday().getTime()
  const eod = endOfToday().getTime()
  if (t < sod) {
    const days = Math.floor((sod - t) / 86_400_000)
    return days === 0 ? 'today' : `${days}d overdue`
  }
  if (t <= eod) return 'today'
  const ahead = Math.ceil((t - eod) / 86_400_000)
  if (ahead <= 1) return 'tomorrow'
  if (ahead <= 14) return `in ${ahead}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const BUCKETS: { key: Bucket; label: string; tone: 'bad' | 'warn' | 'good' | 'neutral' }[] = [
  { key: 'overdue',  label: 'Overdue',     tone: 'bad' },
  { key: 'today',    label: 'Due today',   tone: 'warn' },
  { key: 'upcoming', label: 'Upcoming',    tone: 'good' },
  { key: 'none',     label: 'No due date', tone: 'neutral' },
]

export default function Tasks() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgName, loading: memLoading, canSeeAllJobs, role } = useMembership()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [members, setMembers] = useState<OrgMember[]>([])
  const [jobNames, setJobNames] = useState<Record<string, string>>({})
  const [filterAssignee, setFilterAssignee] = useState<string>('') // '' = all
  const [allJobs, setAllJobs] = useState<{ id: string; name: string }[]>([])
  const [composerOpen, setComposerOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [taskRes, membersRes] = await Promise.all([
        supabase
          .from('fh_job_todos')
          .select('id, text, job_id, assigned_to, user_id, due_at, done, completed_at, created_at')
          .eq('done', false)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(500),
        orgMembersList().catch(() => ({ members: [] as OrgMember[] })),
      ])
      if (taskRes.error) throw new Error(taskRes.error.message)
      const list = (taskRes.data || []) as TaskRow[]
      setTasks(list)
      setMembers((membersRes as any).members || [])

      // Hydrate job names in one batch.
      const jobIds = Array.from(new Set(list.map((t) => t.job_id).filter(Boolean)))
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase
          .from('fh_contacts')
          .select('id, name')
          .in('id', jobIds)
        const map: Record<string, string> = {}
        for (const j of (jobs || [])) map[j.id] = (j as any).name || 'Untitled job'
        setJobNames(map)
      }
      // Active jobs for the "New task" job picker (a todo needs a job).
      const { data: aj } = await supabase
        .from('fh_contacts')
        .select('id, name, job_title')
        .in('stage', ['quote', 'job', 'invoice'])
        .order('updated_at', { ascending: false })
        .limit(200)
      setAllJobs((aj || []).map((j: any) => ({ id: j.id, name: j.job_title || j.name || 'Untitled job' })))
    } catch (e: any) {
      setError(e?.message || 'Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (!memLoading) load() }, [memLoading, load])

  const memberById = useMemo(() => {
    const m: Record<string, OrgMember> = {}
    for (const x of members) m[x.user_id] = x
    return m
  }, [members])

  const filteredTasks = useMemo(() => {
    if (!filterAssignee) return tasks
    if (filterAssignee === '__unassigned__') return tasks.filter((t) => !t.assigned_to)
    if (filterAssignee === '__mine__') return tasks.filter((t) => t.assigned_to === user?.id)
    return tasks.filter((t) => t.assigned_to === filterAssignee)
  }, [tasks, filterAssignee, user?.id])

  // Bucket the filtered list.
  const grouped = useMemo(() => {
    const buckets: Record<Bucket, TaskRow[]> = { overdue: [], today: [], upcoming: [], none: [] }
    for (const t of filteredTasks) buckets[bucketFor(t.due_at)].push(t)
    return buckets
  }, [filteredTasks])

  async function completeTask(rowId: string) {
    // Optimistic.
    setTasks((cur) => cur.filter((t) => t.id !== rowId))
    const { error } = await supabase
      .from('fh_job_todos')
      .update({ done: true, completed_at: new Date().toISOString() })
      .eq('id', rowId)
    if (error) {
      toastError("Couldn't complete", error.message)
      load()
    }
  }

  // Reassign a task to another member (or unassign). Optimistic.
  async function reassignTask(rowId: string, assignee: string | null) {
    setTasks((cur) => cur.map((t) => t.id === rowId ? { ...t, assigned_to: assignee } : t))
    const { error } = await supabase.from('fh_job_todos').update({ assigned_to: assignee }).eq('id', rowId)
    if (error) { toastError("Couldn't reassign", error.message); load() }
  }

  // Delete a task with Undo.
  async function deleteTask(rowId: string) {
    const snapshot = tasks.find((t) => t.id === rowId)
    setTasks((cur) => cur.filter((t) => t.id !== rowId))
    const { error } = await supabase.from('fh_job_todos').delete().eq('id', rowId)
    if (error) { toastError("Couldn't delete", error.message); load(); return }
    toastUndo('Task deleted', {
      description: snapshot?.text || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_job_todos').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        load()
      }
    })
  }

  // Create a task. Needs a job (fh_job_todos.job_id is required).
  async function createTask(input: { text: string; jobId: string; assignedTo: string | null; dueAt: string | null }) {
    if (!input.text.trim() || !input.jobId || !user) return false
    const { error } = await supabase.from('fh_job_todos').insert({
      user_id: user.id,
      job_id: input.jobId,
      text: input.text.trim(),
      assigned_to: input.assignedTo,
      due_at: input.dueAt
    })
    if (error) { toastError("Couldn't add task", error.message); return false }
    toastSuccess('Task added', input.text.trim())
    load()
    return true
  }

  // KPIs use the unfiltered list so the headline numbers stay
  // meaningful regardless of the assignee filter.
  const kpi = useMemo(() => ({
    overdue: tasks.filter((t) => bucketFor(t.due_at) === 'overdue').length,
    today: tasks.filter((t) => bucketFor(t.due_at) === 'today').length,
    unassigned: tasks.filter((t) => !t.assigned_to).length,
    total: tasks.length,
  }), [tasks])

  // Role gate. Backend RLS already enforces; this is a UX rail.
  if (!memLoading && !canSeeAllJobs) {
    return (
      <div className="fh-build-page" data-build-screen="Tasks">
        <main className="fh-build-main">
          <section className="fh-build-hero-row fh-build-hero-row--page">
            <div>
              <div className="fh-build-good">Tasks</div>
              <h1 className="fh-build-title">RESTRICTED.</h1>
            </div>
          </section>
          <div className="fh-build-table__empty">
            Your role ({role || 'unknown'}) can't see every task. Open <button type="button" className="fh-build-inline-link" onClick={() => navigate('/crew')}>your crew home</button> instead — that's your own task list.
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="fh-build-page" data-build-screen="Tasks" data-build-route="/tasks">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{orgName || 'Your team'}</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => navigate('/activity')}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Tasks</div>
            <h1 className="fh-build-title">CLEAR THE QUEUE.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Assignee</div>
            <select
              className="fh-build-select"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="">Everyone ({tasks.length})</option>
              <option value="__mine__">Just mine</option>
              <option value="__unassigned__">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.is_self ? `${m.name || 'Me'} (me)` : (m.name || m.email || 'Teammate')}
                </option>
              ))}
            </select>
            <p>
              {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'} after filter
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Total open" value={loading ? '—' : String(kpi.total)} accent />
            <MiniMetric label="Overdue" value={loading ? '—' : String(kpi.overdue)} tone={!loading && kpi.overdue > 0 ? 'bad' : undefined} />
            <MiniMetric label="Due today" value={loading ? '—' : String(kpi.today)} tone={!loading && kpi.today > 0 ? 'warn' : undefined} />
            <MiniMetric label="Unassigned" value={loading ? '—' : String(kpi.unassigned)} tone={!loading && kpi.unassigned > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {error && (
          <div className="fh-build-banner is-warn">
            <AlertTriangle size={14} />
            <span>{error}</span>
            <button type="button" className="fh-build-banner__cta" onClick={load} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry →</button>
          </div>
        )}

        {/* Create task */}
        {!loading && (
          <div style={{ marginBottom: 16 }}>
            {!composerOpen ? (
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="fh-build-select"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '8px 12px' }}
              >
                <Plus size={13} /> New task
              </button>
            ) : (
              <TaskComposer
                jobs={allJobs}
                members={members}
                onCancel={() => setComposerOpen(false)}
                onCreate={async (input: any) => { const ok = await createTask(input); if (ok) setComposerOpen(false) }}
              />
            )}
          </div>
        )}

        {loading && (
          <div className="fh-build-table__empty">Loading tasks…</div>
        )}

        {!loading && filteredTasks.length === 0 && (
          <div className="fh-build-table__empty">All clear — nothing waiting on the team.</div>
        )}

        {!loading && BUCKETS.map((b) => {
          const rows = grouped[b.key]
          if (rows.length === 0) return null
          return (
            <section key={b.key} className="fh-build-card" style={{ marginBottom: 18 }}>
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">
                  <span className={`fh-build-dot is-${b.tone}`} style={{ marginRight: 8 }}>{b.label}</span>
                  · {rows.length}
                </div>
              </header>

              <div className="fh-build-table__head is-tasks">
                <span>Task</span>
                <span>Job</span>
                <span>Assignee</span>
                <span>Due</span>
                <span />
              </div>

              {rows.map((t) => {
                const assignee = t.assigned_to ? memberById[t.assigned_to] : null
                const assigneeLabel = !t.assigned_to
                  ? 'Unassigned'
                  : assignee
                    ? (assignee.is_self ? 'You' : assignee.name || assignee.email || 'Teammate')
                    : 'Teammate'
                return (
                  <div key={t.id} className="fh-build-table__row is-tasks">
                    <strong className="fh-build-truncate" title={t.text}>{t.text}</strong>
                    <button
                      type="button"
                      onClick={() => navigate(`/jobs/${t.job_id}`)}
                      className="fh-build-truncate"
                      style={{ background: 'transparent', border: 'none', color: 'var(--v3-text)', textAlign: 'left', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {jobNames[t.job_id] || 'Open job'} <ChevronRight size={11} />
                    </button>
                    {canSeeAllJobs ? (
                      <select
                        value={t.assigned_to || ''}
                        onChange={(e) => reassignTask(t.id, e.target.value || null)}
                        className="fh-build-select"
                        style={{ fontSize: 11, padding: '3px 6px', maxWidth: 140 }}
                        aria-label="Assign to"
                        title={assigneeLabel}
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>{m.is_self ? 'You' : (m.name || m.email || 'Teammate')}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`fh-build-dot is-${t.assigned_to ? 'good' : 'warn'}`}>
                        <UserRound size={11} aria-hidden="true" style={{ marginRight: 4 }} />
                        {assigneeLabel}
                      </span>
                    )}
                    <span className={b.key === 'overdue' ? 'fh-build-num' : 'fh-build-rel'} style={{ color: b.key === 'overdue' ? 'var(--v3-danger-bright)' : undefined, fontWeight: b.key === 'overdue' ? 700 : undefined }}>
                      {t.due_at ? <><Calendar size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />{fmtDue(t.due_at)}</> : '—'}
                    </span>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <button
                        type="button"
                        className="fh-build-icon-action"
                        onClick={() => completeTask(t.id)}
                        title="Mark done"
                        aria-label="Mark done"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="fh-build-icon-action"
                        onClick={() => deleteTask(t.id)}
                        title="Delete task"
                        aria-label="Delete task"
                        style={{ color: 'var(--v3-danger-bright)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </main>
    </div>
  )
}

/* Inline new-task composer — text + job (required) + optional assignee
   and due date. */
function TaskComposer({ jobs, members, onCancel, onCreate }: any) {
  const [text, setText] = useState('')
  const [jobId, setJobId] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const canSave = text.trim() && jobId && !busy

  async function submit() {
    if (!canSave) return
    setBusy(true)
    await onCreate({
      text,
      jobId,
      assignedTo: assignedTo || null,
      dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null
    })
    setBusy(false)
  }

  const field: import('react').CSSProperties = { padding: '9px 11px', borderRadius: 10, background: 'var(--v3-glass-tint)', border: '1px solid var(--v3-border-mid)', color: 'var(--v3-text)', fontFamily: 'inherit', fontSize: 13, outline: 'none' }
  return (
    <div className="fh-build-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="What needs doing?" style={field} autoFocus />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)} style={field} aria-label="Job">
          <option value="">Choose a job…</option>
          {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} style={field} aria-label="Assign to">
          <option value="">Unassigned</option>
          {members.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.is_self ? 'You' : (m.name || m.email || 'Teammate')}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={field} aria-label="Due date" />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} disabled={busy} style={{ ...field, cursor: 'pointer', background: 'transparent' }}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canSave} style={{ ...field, cursor: canSave ? 'pointer' : 'not-allowed', background: 'var(--v3-primary, #c9963a)', color: '#1a1712', fontWeight: 700, opacity: canSave ? 1 : 0.5, border: 'none' }}>
          {busy ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </div>
  )
}

// Quiet the unused import in IDEs.
void Clock
