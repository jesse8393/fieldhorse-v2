import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, Briefcase, FileText, Plus, Search, Sparkles } from 'lucide-react'
import DataErrorState from '../components/DataErrorState.tsx'
import MiniMetric from '../components/MiniMetric.tsx'
import SnowPipelineBuild from '../components/desktop/SnowPipelineBuild.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { money } from '../lib/format.ts'
import { queryKeys, useJobs, useJobsRealtime } from '../lib/queries.ts'
import { toastSuccess } from '../lib/toast.ts'

const NewLeadSheet = lazy(() => import('../components/NewLeadSheet.tsx'))

type StageSeed = 'lead' | 'quote' | 'job'

const PIPELINE_STAGES = new Set(['lead', 'quote', 'job', 'invoice', 'closed'])

function detailRoute(contact: any) {
  const stage = String(contact?.stage || '').toLowerCase()
  if (stage === 'lead' || stage === 'lost') return `/leads/${contact.id}`
  if (stage === 'quote') return `/quotes/${contact.id}?tab=quote`
  if (stage === 'invoice' || contact?.completed_at) return `/jobs/${contact.id}?tab=financials`
  return `/jobs/${contact.id}`
}

export default function Pipeline() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const {
    data: contacts = [],
    isLoading: loading,
    isError,
    error,
    refetch,
    isFetching,
  } = useJobs()
  useJobsRealtime(user?.id, queryClient)

  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addStage, setAddStage] = useState<StageSeed>('lead')

  const pipelineContacts = useMemo(
    () => contacts.filter((c: any) => PIPELINE_STAGES.has(String(c.stage || '').toLowerCase())),
    [contacts]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return pipelineContacts
    return pipelineContacts.filter((c: any) =>
      [c.name, c.job_title, c.job_type, c.phone, c.email, c.address]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [pipelineContacts, search])

  const stats = useMemo(() => {
    const lead = pipelineContacts.filter((c: any) => c.stage === 'lead').length
    const quote = pipelineContacts.filter((c: any) => c.stage === 'quote').length
    const active = pipelineContacts.filter((c: any) => c.stage === 'job' || c.stage === 'invoice').length
    const collect = pipelineContacts.filter((c: any) => c.stage === 'invoice' || (c.stage === 'job' && c.completed_at)).length
    const total = pipelineContacts
      .filter((c: any) => ['lead', 'quote', 'job', 'invoice'].includes(String(c.stage || '').toLowerCase()))
      .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0)
    return { lead, quote, active, collect, total }
  }, [pipelineContacts])

  const loadError = isError
    ? error instanceof Error ? error.message : 'The pipeline request failed.'
    : ''

  function openCreate(stage: StageSeed) {
    setAddStage(stage)
    setAddOpen(true)
  }

  return (
    <div className="fh-build-page" data-build-screen="Pipeline">
      <header className="fh-build-topbar">
        <div className="fh-build-search" role="search">
          <Search size={14} />
          <input
            className="fh-build-search__input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search pipeline"
            autoComplete="off"
            placeholder="Search leads, quotes, jobs, invoices..."
          />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="fh-build-topbar__meta">
          <span>{filtered.length.toLocaleString()} records visible</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Lead to cash</span>
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
        <button className="fh-build-new-btn" type="button" onClick={() => openCreate('lead')}>
          <Plus size={15} /> New Lead
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Pipeline OS</div>
            <h1 className="fh-build-title">LEAD TO CASH.</h1>
          </div>

          <div className="fh-build-view-card">
            <div className="fh-build-eyebrow">Sequence</div>
            <div className="fh-build-view-toggle" role="group" aria-label="Create pipeline record">
              <button type="button" onClick={() => openCreate('lead')}>
                <Sparkles size={13} /> Lead
              </button>
              <button type="button" onClick={() => openCreate('quote')}>
                <FileText size={13} /> Quote
              </button>
              <button type="button" onClick={() => openCreate('job')}>
                <Briefcase size={13} /> Job
              </button>
            </div>
            <p className="fh-build-view-card__copy">
              Separate desks, one handoff: capture, propose, deliver, collect.
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Open value" value={money(stats.total)} accent />
            <MiniMetric label="Leads" value={String(stats.lead)} />
            <MiniMetric label="Quotes" value={String(stats.quote)} />
            <MiniMetric label="Ready to collect" value={String(stats.collect)} />
          </div>
        </section>

        {loadError && filtered.length > 0 && (
          <DataErrorState
            compact
            title="Could not refresh pipeline"
            message="Showing the last loaded results."
            onRetry={() => { void refetch() }}
            actionLabel={isFetching ? 'Retrying' : 'Retry'}
          />
        )}

        {loading ? (
          <div className="fh-build-table__empty">Loading pipeline...</div>
        ) : loadError && filtered.length === 0 ? (
          <DataErrorState
            title="Could not load pipeline"
            message={loadError}
            onRetry={() => { void refetch() }}
            actionLabel={isFetching ? 'Retrying' : 'Retry'}
          />
        ) : (
          <SnowPipelineBuild
            contacts={filtered}
            onOpenContact={(contact) => navigate(detailRoute(contact))}
            onNewLead={() => openCreate('lead')}
            onNewQuote={() => openCreate('quote')}
            onNewJob={() => openCreate('job')}
          />
        )}
      </main>

      <Suspense fallback={null}>
        <NewLeadSheet
          open={addOpen}
          userId={user?.id}
          initialStage={addStage}
          lockStage
          onClose={() => setAddOpen(false)}
          onCreated={async (created: any) => {
            setAddOpen(false)
            await queryClient.invalidateQueries({ queryKey: queryKeys.jobs })
            toastSuccess(`New ${created?.stage || addStage} added`, created?.name ? `${created.name} is in the sequence` : 'In the sequence')
            if (created?.id) navigate(detailRoute(created))
          }}
        />
      </Suspense>
    </div>
  )
}
