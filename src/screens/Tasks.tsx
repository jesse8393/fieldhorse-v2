// Tasks, /tasks. Cross-job task dashboard for owners / admins /
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
// route from foreman/crew is the only role gate, they see their own
// open tasks on /crew, which is the right surface for those roles.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Calendar, Check, ChevronRight, ClipboardCheck, Trash2, Plus,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { orgMembersList, type OrgMember } from '../lib/orgApi.ts'
import { toastError, toastSuccess, toastUndo } from '../lib/toast.ts'
import { Button } from '../ui/index.ts'
import './tasks.css'

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
  if (!iso) return '\u2003'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '\u2003'
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
  const { loading: memLoading, canSeeAllJobs, role } = useMembership()

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
        <div className="fh-build-main">
          <section className="fh-build-hero-row fh-build-hero-row--page">
            <div>
              <div className="fh-build-good">Tasks</div>
              <h1 className="fh-build-title">Restricted access</h1>
            </div>
          </section>
          <div className="fh-build-table__empty">
            Your role ({role || 'unknown'}) can't see every task. Open <button type="button" className="fh-build-inline-link" onClick={() => navigate('/crew')}>your crew home</button> instead, that's your own task list.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fh-tasks" data-build-screen="Tasks" data-build-route="/tasks">
      <header className="fh-tasks-heading">
        <div><h1>Tasks</h1><p>Open work across your jobs.</p></div>
        {!composerOpen && <Button type="button" leftIcon={Plus} onClick={() => setComposerOpen(true)}>New task</Button>}
      </header>

      <dl className="fh-tasks-summary" aria-label="Task summary">
        {[
          ['Total open', kpi.total], ['Overdue', kpi.overdue],
          ['Due today', kpi.today], ['Unassigned', kpi.unassigned]
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{loading ? '…' : value}</dd></div>)}
      </dl>

      <div className="fh-tasks-filter">
        <label htmlFor="task-assignee-filter">Show tasks for</label>
        <select id="task-assignee-filter" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">Everyone</option><option value="__mine__">Just mine</option><option value="__unassigned__">Unassigned</option>
          {members.map(m => <option key={m.user_id} value={m.user_id}>{m.is_self ? 'You' : (m.name || m.email || 'Teammate')}</option>)}
        </select>
        {!loading && <span role="status">{filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}</span>}
      </div>

      {error && <div className="fh-tasks-error" role="alert"><AlertTriangle size={20} /><span>{error}</span><Button type="button" variant="outline" onClick={load}>Retry</Button></div>}
      {composerOpen && <TaskComposer jobs={allJobs} members={members} onCancel={() => setComposerOpen(false)}
        onCreate={async input => { const ok = await createTask(input); if (ok) setComposerOpen(false) }} />}
      {loading && <p role="status">Loading tasks…</p>}
      {!loading && !error && filteredTasks.length === 0 && <div className="fh-tasks-empty">
        <ClipboardCheck size={24} aria-hidden="true" />
        <p>{tasks.length === 0 ? 'No open tasks.' : 'No tasks match this assignee.'}</p>
        {tasks.length > 0 && <Button type="button" variant="outline" onClick={() => setFilterAssignee('')}>Clear filter</Button>}
      </div>}

      {!loading && BUCKETS.map(bucket => {
        const rows = grouped[bucket.key]
        if (!rows.length) return null
        return <section key={bucket.key} className="fh-tasks-group" aria-labelledby={`tasks-${bucket.key}`}>
          <h2 id={`tasks-${bucket.key}`}>{bucket.label} <span>{rows.length}</span></h2>
          <ul className="fh-tasks-list">
            {rows.map(task => {
              const member = task.assigned_to ? memberById[task.assigned_to] : null
              return <li key={task.id} className="fh-task-row">
                <strong className="fh-task-row__title">{task.text}</strong>
                <Link className="fh-task-row__job" to={`/jobs/${task.job_id}`}>
                  {jobNames[task.job_id] || 'Open job'}<ChevronRight size={16} aria-hidden="true" />
                </Link>
                <label className="fh-task-row__assignee"><span>Assigned to</span>
                  <select value={task.assigned_to || ''} onChange={e => reassignTask(task.id, e.target.value || null)} aria-label={`Assign ${task.text}`}>
                    <option value="">Unassigned</option>
                    {task.assigned_to && !member && <option value={task.assigned_to}>{task.assigned_to === user?.id ? 'You' : 'Teammate'}</option>}
                    {members.map(m => <option key={m.user_id} value={m.user_id}>{m.is_self ? 'You' : (m.name || m.email || 'Teammate')}</option>)}
                  </select>
                </label>
                <span className={`fh-task-row__due${bucket.key === 'overdue' ? ' is-overdue' : ''}`}>
                  <Calendar size={16} aria-hidden="true" />{task.due_at ? fmtDue(task.due_at) : 'No due date'}
                </span>
                <div className="fh-task-row__actions">
                  <Button type="button" variant="outline" leftIcon={Check} onClick={() => completeTask(task.id)} aria-label={`Complete ${task.text}`}>Complete</Button>
                  <button type="button" className="fh-task-row__delete" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.text}`} title="Delete task"><Trash2 size={18} aria-hidden="true" /></button>
                </div>
              </li>
            })}
          </ul>
        </section>
      })}
    </div>
  )
}

/* Inline new-task composer, text + job (required) + optional assignee
   and due date. */
type TaskInput = { text: string; jobId: string; assignedTo: string | null; dueAt: string | null }

function TaskComposer({ jobs, members, onCancel, onCreate }: {
  jobs: { id: string; name: string }[]
  members: OrgMember[]
  onCancel: () => void
  onCreate: (input: TaskInput) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [jobId, setJobId] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const canSave = Boolean(text.trim() && jobId && !busy)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      await onCreate({ text, jobId, assignedTo: assignedTo || null, dueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null })
    } finally { setBusy(false) }
  }

  return (
    <form className="fh-task-composer" onSubmit={submit} aria-label="New task">
      <h2>New task</h2>
      <label>Task<input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="What needs doing?" required autoFocus /></label>
      <label>Job<select value={jobId} onChange={e => setJobId(e.target.value)} required>
        <option value="">Choose a job</option>
        {jobs.map(job => <option key={job.id} value={job.id}>{job.name}</option>)}
      </select></label>
      <label>Assigned to<select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
        <option value="">Unassigned</option>
        {members.map(member => <option key={member.user_id} value={member.user_id}>{member.is_self ? 'You' : (member.name || member.email || 'Teammate')}</option>)}
      </select></label>
      <label>Due date<input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
      {!jobs.length && <p>Add a job before creating tasks. <Link to="/jobs/new">New job</Link></p>}
      <div className="fh-task-composer__actions">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" disabled={!canSave}>{busy ? 'Adding…' : 'Add task'}</Button>
      </div>
    </form>
  )
}
