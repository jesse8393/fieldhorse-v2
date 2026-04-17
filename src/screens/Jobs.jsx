import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import NewLeadSheet from '../components/NewLeadSheet.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonList, SkeletonStat } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGES, STAGE_MAP, ACTIVE_STAGES, margin, marginTier } from '../lib/stages.js'

const FILTERS = [{ id: 'all', label: 'All' }, ...STAGES.map((s) => ({ id: s.id, label: s.label }))]

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function initials(name) {
  if (!name) return '—'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

export default function Jobs() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [justAddedId, setJustAddedId] = useState(null)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fh_contacts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (!error) setContacts(data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setAddOpen(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const filtered = useMemo(() => {
    let rows = contacts
    if (filter !== 'all') rows = rows.filter((c) => c.stage === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) =>
        [c.name, c.job_title, c.job_type, c.phone, c.email, c.address, c.referred_by]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q))
      )
    }
    return rows
  }, [contacts, filter, search])

  const summary = useMemo(() => {
    const pipeline = contacts
      .filter((c) => ACTIVE_STAGES.includes(c.stage))
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    const activeCount = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage)).length
    const margins = contacts
      .filter((c) => c.amount > 0)
      .map((c) => margin(c))
    const avgMargin = margins.length
      ? margins.reduce((s, m) => s + m, 0) / margins.length
      : 0
    const wonYtd = contacts
      .filter((c) => c.stage === 'closed')
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    return { pipeline, activeCount, avgMargin, wonYtd }
  }, [contacts])

  return (
    <section className="fh-page fh-jobs">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">Pipeline</span>
          </span>
          <h1 className="fh-page__title">Jobs</h1>
        </div>
        <div className="fh-page__headActions">
          {summary.activeCount > 0 && (
            <span className="fh-status-pill fh-status-pill--gold">{summary.activeCount} active</span>
          )}
          <button type="button" className="fh-btn fh-btn--gold" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={18} />
            <span>New lead</span>
          </button>
        </div>
      </header>

      <div className="fh-summary">
        <SummaryStat code="01·PIPE" label="Pipeline" value={money(summary.pipeline)} accent />
        <SummaryStat code="02·ACT" label="Active" value={summary.activeCount} />
        <SummaryStat code="03·MRG" label="Avg margin" value={`${summary.avgMargin.toFixed(0)}%`} />
        <SummaryStat code="04·YTD" label="Won YTD" value={money(summary.wonYtd)} />
      </div>

      <div className="fh-filterbar">
        <div className="fh-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Search jobs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="fh-chips" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`fh-chip${filter === f.id ? ' is-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && (
                <span className="fh-chip__count">
                  {contacts.filter((c) => c.stage === f.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="fh-list">
        {loading && <SkeletonList rows={5} />}
        {!loading && filtered.length === 0 && (
          filter !== 'all' || search ? (
            <EmptyState
              icon="search"
              code="FILTER · ACTIVE"
              title="No jobs match that filter."
              sub="Clear the search or switch stages to see more."
            />
          ) : (
            <EmptyState
              icon="pipeline"
              code="EMPTY BOARD"
              title="No jobs on the board."
              sub="Drop in your first lead. Watch the pipeline fill."
              action="Add first lead"
              onAction={() => setAddOpen(true)}
            />
          )
        )}
        <AnimatePresence>
          {filtered.map((c, i) => {
            const isNew = c.id === justAddedId
            return (
            <motion.button
              key={c.id}
              type="button"
              layout
              className={`fh-card fh-card--stage fh-card--${c.stage}${isNew ? ' just-added' : ''}`}
              onClick={() => navigate(`/jobs/${c.id}`)}
              initial={isNew ? { opacity: 0, scale: 0.9, y: 0 } : { opacity: 0, y: 8 }}
              animate={isNew ? { opacity: 1, scale: [0.9, 1.02, 1], y: 0 } : { opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={isNew
                ? { duration: 0.6, ease: [0.16, 1, 0.3, 1] }
                : { duration: 0.18, delay: Math.min(i * 0.02, 0.2) }
              }
            >
              <span className="fh-avatar" aria-hidden="true">{initials(c.name)}</span>
              <div className="fh-card__body">
                <div className="fh-card__row">
                  <span className="fh-card__title">{c.name || 'Untitled'}</span>
                  <span className="fh-card__amount">{money(c.amount)}</span>
                </div>
                <div className="fh-card__sub">
                  <span>{c.job_title || c.job_type || 'No job title'}</span>
                  <span className="fh-card__dot" aria-hidden="true" />
                  <MarginPill pct={margin(c)} hasCost={c.cost > 0} />
                </div>
              </div>
              <StageBadge id={c.stage} />
            </motion.button>
            )
          })}
        </AnimatePresence>
      </div>

      <NewLeadSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onCreated={async (created) => {
          setAddOpen(false)
          if (created?.id) setJustAddedId(created.id)
          await load()
          setTimeout(() => setJustAddedId(null), 1200)
        }}
      />
    </section>
  )
}

function SummaryStat({ label, value, accent, code }) {
  return (
    <div className={`fh-stat${accent ? ' fh-stat--accent' : ''}`}>
      {code && <span className="fh-spec-code" aria-hidden="true">{code}</span>}
      <span className="fh-stat__k">{label}</span>
      <span className="fh-stat__v">{value}</span>
    </div>
  )
}

function StageBadge({ id }) {
  const s = STAGE_MAP[id]
  if (!s) return null
  return (
    <span className="fh-stagebadge" style={{ '--stage-color': s.color }}>
      <span className="fh-stagebadge__dot" />
      {s.label}
    </span>
  )
}

function MarginPill({ pct, hasCost }) {
  if (!hasCost) return <span className="fh-margin fh-margin--neutral">No cost yet</span>
  const tier = marginTier(pct)
  return <span className={`fh-margin fh-margin--${tier}`}>{pct.toFixed(0)}% margin</span>
}


