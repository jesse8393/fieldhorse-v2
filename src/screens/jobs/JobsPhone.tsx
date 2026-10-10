// Jobs on a phone (spec 9.3, render base/jobs.jpg). Below 900 px Work.tsx
// renders this in place of the deal cards: a condensed "Jobs" title with
// New lead, search and filter beside it, text tabs with counts (All,
// Leads, Quotes, Jobs, Done, decision D3), then grouped hairline rows.
// Lost jobs sit behind the filter sheet. Each row links to its job,
// where the stage actions live.
//
// The list itself comes from buildJobsList (lib/jobsList.ts); this file
// only owns the view state: the tab (kept in ?stage= so old links land
// right), the lost switch, the sort and the search field.

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { HardHat, ListFilter, Plus, Search, SearchX } from 'lucide-react'
import { Button, Chip, EmptyState, Field, IconButton, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useNavAccess } from '../../lib/useNavAccess.ts'
import { useScheduleEvents, type JobRow } from '../../lib/queries.ts'
import { buildJobsList, JOBS_TABS, type JobsRowView, type JobsSort, type JobsTab } from '../../lib/jobsList.ts'
import { handleTablistKeyDown, tabId, tabPanelId, tabPanelProps } from '../../lib/tabs.ts'
import { todayYmd } from '../../lib/dates.ts'
import { hapticTap } from '../../lib/haptics.ts'
import JobsFilterSheet from './JobsFilterSheet.tsx'
import './jobs.css'

export type JobsPhoneProps = {
  /** Rows the viewer may see, already narrowed to the search. */
  jobs: JobRow[]
  loading: boolean
  /** Empty when the last load worked. */
  loadError: string
  retrying: boolean
  onRetry: () => void
  search: string
  onSearchChange: (value: string) => void
  /** The whole book search failed; the rows are the cached ones only. */
  searchDegraded: boolean
  /** Owner, admin and manager. Crew and field roles never see money. */
  showMoney: boolean
  /** Field roles see only the work they are on: no Leads or Quotes tabs. */
  fieldView: boolean
  onNewLead: () => void
}

// Old links: ?stage=active was the Jobs tab, ?stage=lost the Lost chip.
function tabFromStage(stage: string | null): JobsTab {
  switch (stage) {
    case 'leads': return 'leads'
    case 'quotes': return 'quotes'
    case 'jobs':
    case 'active': return 'jobs'
    case 'done': return 'done'
    default: return 'all'
  }
}

const EMPTY_TAB: Record<JobsTab, string> = {
  all: 'No jobs yet.',
  leads: 'No open leads.',
  quotes: 'No quotes waiting.',
  jobs: 'No jobs in progress.',
  done: 'Nothing finished yet.'
}

// Visits from 60 days back (so a job already under way reads "Next visit"
// rather than "Starts") to two weeks ahead.
function visitWindow(dayKey: string): { start: string; end: string } {
  const [y, m, d] = dayKey.split('-').map(Number)
  return {
    start: new Date(y, m - 1, d - 60).toISOString(),
    end: new Date(y, m - 1, d + 15).toISOString()
  }
}

function rowEnd(row: JobsRowView): ReactNode {
  // Money, then a chip or the gray next step. A row without money has
  // room for both, as the new lead in the render does.
  const items: ReactNode[] = []
  if (row.chip) items.push(<Chip key="chip" label={row.chip.label} tone={row.chip.tone} />)
  if (row.next && (!row.chip || row.money == null)) {
    items.push(<span key="next" className="fhc-row__next">{row.next}</span>)
  }
  return items.length ? items : null
}

export default function JobsPhone({
  jobs,
  loading,
  loadError,
  retrying,
  onRetry,
  search,
  onSearchChange,
  searchDegraded,
  showMoney,
  fieldView,
  onNewLead
}: JobsPhoneProps) {
  const { user } = useAuth()
  const { canSee } = useNavAccess()
  const idBase = useId()
  const searchFieldId = `${idBase}-search`
  const searchRef = useRef<HTMLInputElement>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const stageParam = searchParams.get('stage')

  // ?stage=lost turns the switch on; picking a tab afterwards keeps it on.
  const [showLost, setShowLost] = useState(() => stageParam === 'lost')
  const [seenStage, setSeenStage] = useState(stageParam)
  if (seenStage !== stageParam) {
    setSeenStage(stageParam)
    if (stageParam === 'lost') setShowLost(true)
  }
  const [sort, setSort] = useState<JobsSort>('next')
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(() => search !== '')

  const tabs = useMemo(
    () => (fieldView ? JOBS_TABS.filter((t) => t.id !== 'leads' && t.id !== 'quotes') : JOBS_TABS),
    [fieldView]
  )
  const requestedTab = tabFromStage(stageParam)
  const tab: JobsTab = tabs.some((t) => t.id === requestedTab) ? requestedTab : 'all'

  const dayKey = todayYmd()
  const range = useMemo(() => visitWindow(dayKey), [dayKey])
  const { data: visits } = useScheduleEvents(user?.id, range.start, range.end)

  const view = useMemo(
    () => buildJobsList({ jobs, tab, showLost, showMoney, now: new Date(), visits, sort }),
    [jobs, tab, showLost, showMoney, visits, sort]
  )

  const writeStage = (stage: string | null) => {
    const sp = new URLSearchParams(searchParams)
    if (stage) sp.set('stage', stage)
    else sp.delete('stage')
    setSearchParams(sp, { replace: true })
  }

  const selectTab = (id: JobsTab) => {
    hapticTap()
    writeStage(id === 'all' ? null : id)
  }

  const changeShowLost = (next: boolean) => {
    setShowLost(next)
    // An old ?stage=lost link would switch it back on after a refresh.
    if (!next && stageParam === 'lost') writeStage(null)
  }

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false)
      onSearchChange('')
      return
    }
    // Render the field now so focus lands inside this tap, which is what
    // lets a phone raise its keyboard.
    flushSync(() => setSearchOpen(true))
    searchRef.current?.focus()
  }

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchOpen(false)
      onSearchChange('')
    }
  }

  const filterTitle = showMoney ? 'Filter and sort' : 'Filter'
  const query = search.trim()
  const hasRows = view.groups.length > 0

  let body: ReactNode
  if (loading && !hasRows) {
    body = <SkeletonRows rows={6} label="Loading jobs" />
  } else if (loadError && jobs.length === 0) {
    body = (
      <DataErrorState
        title="Could not load your jobs"
        message={loadError}
        onRetry={onRetry}
        actionLabel={retrying ? 'Retrying' : 'Retry'}
      />
    )
  } else if (!hasRows) {
    // Empty: one line and the one action that fills the list (spec 9.13).
    if (query) {
      body = (
        <EmptyState
          icon={SearchX}
          title="Nothing matches that search."
          action={<Button variant="secondary" size="md" onClick={() => onSearchChange('')}>Clear search</Button>}
        />
      )
    } else if (tab !== 'all') {
      body = (
        <EmptyState
          icon={HardHat}
          title={EMPTY_TAB[tab]}
          action={<Button variant="secondary" size="md" onClick={() => selectTab('all')}>Show all</Button>}
        />
      )
    } else {
      body = (
        <EmptyState
          icon={HardHat}
          title={EMPTY_TAB.all}
          action={canSee('/import') ? <Button variant="secondary" size="md" to="/import">Import from Jobber</Button> : undefined}
        />
      )
    }
  } else {
    body = view.groups.map((g) => {
      const headingId = `${idBase}-group-${g.id}`
      return (
        <section key={g.id} className="fhj-group" aria-labelledby={headingId}>
          <div className="fhj-group__head">
            <h2 className="fhj-group__title" id={headingId}>{g.title}</h2>
            <p className="fhj-group__note">{g.note}</p>
          </div>
          <ul className="fhj-rows">
            {g.rows.map((r) => (
              <Row
                key={r.id}
                as="li"
                to={r.to}
                title={r.title}
                subline={r.subline || undefined}
                money={r.money}
                next={rowEnd(r)}
              />
            ))}
          </ul>
        </section>
      )
    })
  }

  return (
    <div className="v3-screen fhj">
      <div className="fhj-head">
        <h1 className="fhj-title">Jobs</h1>
        <div className="fhj-head__actions">
          <Button variant="secondary" size="mini" icon={Plus} onClick={onNewLead}>
            New lead
          </Button>
          <IconButton
            aria-label="Search jobs"
            icon={Search}
            size={44}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? searchFieldId : undefined}
            onClick={toggleSearch}
          />
          <IconButton
            aria-label={filterTitle}
            icon={ListFilter}
            size={44}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen(true)}
          />
        </div>
      </div>

      {searchOpen && (
        <div className="fhj-search">
          <Field
            ref={searchRef}
            id={searchFieldId}
            label="Search jobs"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Names, numbers, addresses"
            autoComplete="off"
            enterKeyHint="search"
            helper={searchDegraded && query.length >= 2
              ? 'Showing recent jobs only. Full history search is out of reach right now.'
              : undefined}
          />
        </div>
      )}

      <div className="fhj-tabs" role="tablist" aria-label="Job stages" onKeyDown={handleTablistKeyDown}>
        {tabs.map((t) => {
          const selected = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(idBase, t.id)}
              aria-selected={selected}
              aria-controls={tabPanelId(idBase, t.id)}
              tabIndex={selected ? 0 : -1}
              className="fhj-tab"
              onClick={() => { if (!selected) selectTab(t.id) }}
            >
              <span className="fhj-tab__label">{t.label}</span>
              {!loading && <span className="fhj-tab__count">{view.counts[t.id]}</span>}
            </button>
          )
        })}
      </div>

      <div className="fhj-list" {...tabPanelProps(idBase, tab)}>
        {loadError && jobs.length > 0 && (
          <div className="fhj-notice">
            <DataErrorState
              compact
              title="Could not refresh"
              message="Showing the last loaded results."
              onRetry={onRetry}
              actionLabel={retrying ? 'Retrying' : 'Retry'}
            />
          </div>
        )}
        {hasRows ? body : <div className="fhj-state">{body}</div>}
      </div>

      <JobsFilterSheet
        title={filterTitle}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        showLost={showLost}
        onShowLostChange={changeShowLost}
        sort={sort}
        onSortChange={setSort}
        canSortByAmount={showMoney}
      />
    </div>
  )
}
