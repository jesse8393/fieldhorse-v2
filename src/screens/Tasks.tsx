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
  AlertTriangle, Bell, Calendar, Check, ChevronRight, Clock, Search, UserRound,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { orgMembersList, type OrgMember } from '../lib/orgApi.ts'
import { toastError } from '../lib/toast.ts'
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
            <MiniMetric label="Total open" value={String(kpi.total)} accent />
            <MiniMetric label="Overdue" value={String(kpi.overdue)} tone={kpi.overdue > 0 ? 'bad' : undefined} />
            <MiniMetric label="Due today" value={String(kpi.today)} tone={kpi.today > 0 ? 'warn' : undefined} />
            <MiniMetric label="Unassigned" value={String(kpi.unassigned)} tone={kpi.unassigned > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {error && (
          <div className="fh-build-banner is-warn">
            <AlertTriangle size={14} />
            <span>{error}</span>
            <button type="button" className="fh-build-banner__cta" onClick={load} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry →</button>
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
                      style={{ background: 'transparent', border: 'none', color: '#f4f1ea', textAlign: 'left', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {jobNames[t.job_id] || 'Open job'} <ChevronRight size={11} />
                    </button>
                    <span className={`fh-build-dot is-${t.assigned_to ? 'good' : 'warn'}`}>
                      <UserRound size={11} aria-hidden="true" style={{ marginRight: 4 }} />
                      {assigneeLabel}
                    </span>
                    <span className={b.key === 'overdue' ? 'fh-build-num' : 'fh-build-rel'} style={{ color: b.key === 'overdue' ? '#ee4942' : undefined, fontWeight: b.key === 'overdue' ? 700 : undefined }}>
                      {t.due_at ? <><Calendar size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />{fmtDue(t.due_at)}</> : '—'}
                    </span>
                    <button
                      type="button"
                      className="fh-build-icon-action"
                      onClick={() => completeTask(t.id)}
                      title="Mark done"
                      aria-label="Mark done"
                    >
                      <Check size={14} />
                    </button>
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

// Quiet the unused import in IDEs.
void Clock
