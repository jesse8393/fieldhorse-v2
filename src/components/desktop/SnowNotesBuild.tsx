import RecordPicker from '../RecordPicker.tsx'
// SnowNotesBuild, desktop /notes in the Build direction.
//
// Drop-in for SnowNotes at >=900px. Treats notes as field intelligence
// and job documentation, not a journal.
//
// Layout:
//   Topbar
//   Hero (title + Capture panel + KPIs)
//   Two-column main: Capture+Reports feed (left) | Signal rail (right)

import type { ReactNode } from 'react'
import {
  Bell,
  ChevronRight,
  Mic,
  Search,
  Send,
  Sparkles,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Link as LinkIcon,
} from 'lucide-react'
import MiniMetric from '../MiniMetric.tsx'
import LoadingValue from '../LoadingValue.tsx'
import TopbarWeather from './TopbarWeather.tsx'
import { countNoun } from '../../lib/format.ts'
import PaletteKeyCap, { paletteShortcut } from './PaletteKeyCap.tsx'
import { reportJobLabel, type ReportJob } from '../../lib/reportHistory.ts'
import ReportDetails from '../ReportDetails.tsx'

type Contact = ReportJob
type Note = {
  id: string
  body?: string | null
  title?: string | null
  contact_id?: string | null
  created_at?: string | null
  // fh_notes.parsed is free form JSON from the AI parse (or null).
  parsed?: unknown
}

type ParsedNote = {
  summary?: string
  action_items?: string[]
  risks?: string[]
  follow_up_date?: string
  materials_needed?: string[]
}

function asParsed(value: unknown): ParsedNote | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ParsedNote) : null
}

type Props = {
  /** True until the first read is in: the counts and the all clear lines show skeletons. */
  loading: boolean
  /**
   * The read failed with nothing to show: this error, with its Try again,
   * stands where the reports go, and the counts and the rail wait. The
   * capture panel stays, so a report can still be saved.
   */
  readError?: ReactNode
  /** The Latest reports card, where focus waits while Try again reads again. */
  reportsRef?: (el: HTMLElement | null) => void
  contacts: Contact[]
  contactsReady: boolean
  contactsError: boolean
  recent: Note[]
  historySearch: ReactNode
  historyMore: ReactNode
  historyQuery: string
  onShowUnlinked: () => void
  linkedGroups: { contactId: string; name: string; items: Note[] }[]
  actionItems: { noteId: string; contactId: string | null; text: string; when: string | null }[]
  cockpitStats: { total: number; recent24: number; parsedCount: number; riskCount: number; unlinkedCount: number }
  draft: string
  setDraft: (s: string) => void
  // Parent screen stores contactId as plain string ('' when unlinked),
  // so type it that way to satisfy useState's Dispatch signature.
  contactId: string
  setContactId: (id: string) => void
  saving: boolean
  parsing: boolean
  parsed: any
  parseError: string | null
  voiceState?: any
  onStartVoice: () => void
  onStopVoice: () => void
  onParse: () => void
  onSave: () => void
  onMarkDone: (id: string) => void
  onDelete: (id: string) => void
  onOpenJob: (id: string) => void
}

function relTime(iso: any) {
  if (!iso) return '\u2003'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '\u2003'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SnowNotesBuild(props: Props) {
  const {
    loading, readError = null, reportsRef, contacts, contactsReady, contactsError, recent, historySearch, historyMore, historyQuery, onShowUnlinked, actionItems, cockpitStats,
    draft, setDraft, contactId, setContactId,
    saving, parsing, parsed, parseError,
    voiceState, onStartVoice, onStopVoice, onParse, onSave,
    onMarkDone, onDelete, onOpenJob,
  } = props

  const listening = !!(voiceState && (voiceState.listening || voiceState === 'listening'))
  const failed = readError != null
  const unlinkedCount = cockpitStats.unlinkedCount
  // While the reports load, a skeleton stands in each count's place.
  const pending = (label: string, width = 48) => <LoadingValue label={label} width={width} height={20} />
  const railPending = <strong>{pending('Loading', 56)}</strong>

  return (
    <div className="fh-build-page" data-build-screen="SnowNotesBuild">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <PaletteKeyCap />
        </button>
        <div className="fh-build-topbar__meta">
          {!failed && (
            <span>
              {loading
                ? <LoadingValue label="Loading your reports" width={112} height={12} />
                : `${cockpitStats.total.toLocaleString()} ${countNoun(cockpitStats.total, 'report')} captured`}
            </span>
          )}
          <TopbarWeather lead />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <div className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Operations</div>
            <h1 className="fh-build-title">Field reports</h1>
          </div>

          {/* After a failed read there is no pulse to give: it waits. */}
          {!failed && (
            <>
              <div className="fh-build-focus">
                <div className="fh-build-eyebrow">Report history</div>
                <p>
                  {loading ? (
                    <LoadingValue label="Loading today's pulse" width={200} height={14} />
                  ) : (
                    <>
                      {cockpitStats.recent24} captured in 24h ·
                      {' '}{cockpitStats.parsedCount} parsed by AI across all reports
                    </>
                  )}
                </p>
                {cockpitStats.riskCount > 0 && (
                  <p style={{ color: 'var(--v3-primary-text)', marginTop: 6 }}>
                    <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                    {cockpitStats.riskCount} report{cockpitStats.riskCount === 1 ? '' : 's'} with flagged risks across all history
                  </p>
                )}
              </div>

              <div className="fh-build-mini-grid">
                <MiniMetric label="Reports in 24h" value={loading ? pending('Loading reports in 24h') : String(cockpitStats.recent24)} accent />
                <MiniMetric label="AI parsed, all reports" value={loading ? pending('Loading AI parsed reports') : String(cockpitStats.parsedCount)} />
                <MiniMetric label="Reports with risks, all" value={loading ? pending('Loading flagged reports') : String(cockpitStats.riskCount)} tone={cockpitStats.riskCount > 0 ? 'warn' : undefined} />
                <MiniMetric label="Unlinked, all reports" value={loading ? pending('Loading missing job links') : String(unlinkedCount)} tone={unlinkedCount > 0 ? 'warn' : undefined} />
              </div>
            </>
          )}
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--notes">
          <div className="fh-build-notes-main">
            {/* Capture panel */}
            <section className="fh-build-card fh-build-capture">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Capture report</div>
                <button
                  type="button"
                  className={`fh-build-mic-btn${listening ? ' is-on' : ''}`}
                  onClick={listening ? onStopVoice : onStartVoice}
                  aria-label={listening ? 'Stop voice capture' : 'Start voice capture'}
                >
                  <Mic size={14} /> {listening ? 'Stop' : 'Voice'}
                </button>
              </header>

              <div className="fh-build-capture__body">
                <textarea
                  aria-label="Field report"
                  className="fh-build-capture__textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="What happened on site? Speak or type, AI will pull out action items, risks, and materials."
                  rows={4}
                  style={{ background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)', fontSize: 16 }}
                />

                <div className="fh-build-capture__row">
                  <RecordPicker id="report-job" label="Link to job" disabled={!contactsReady} loading={!contactsReady && !contactsError}
                    error={contactsError ? 'Job names unavailable. Retry job lookup below.' : undefined} value={contactId || ''} onChange={setContactId}
                    options={contacts.map((c) => ({ value: c.id, label: reportJobLabel(c) }))}
                    clearLabel="No job link" placeholder="Search customer, job, address or reference" />
                </div>

                {parseError && (
                  <div className="fh-build-capture__error">{parseError}</div>
                )}

                {parsed && (
                  <div className="fh-build-capture__parsed">
                    <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary-text)' }}>AI parse preview</div>
                    {parsed.summary && <p>{parsed.summary}</p>}
                    {parsed.action_items?.length > 0 && (
                      <ul>
                        {parsed.action_items.slice(0, 4).map((it: string, i: number) => (
                          <li key={i}>{it}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div className="fh-build-capture__actions">
                  <button
                    type="button"
                    className="fh-build-secondary-btn"
                    onClick={onParse}
                    disabled={parsing || !draft.trim()}
                  >
                    <Sparkles size={13} /> {parsing ? 'Parsing…' : 'AI Parse'}
                  </button>
                  <button
                    type="button"
                    className="fh-build-primary-btn"
                    onClick={onSave}
                    disabled={saving || !draft.trim()}
                  >
                    <Send size={13} /> {saving ? 'Saving…' : 'Save report'}
                  </button>
                </div>
              </div>
            </section>

            {/* Recent reports */}
            <section
              ref={reportsRef}
              className="fh-build-card fh-build-table fh-build-notes-table"
              aria-label="Latest reports"
              tabIndex={-1}
            >
              <header className="fh-build-card-head">
                {/* Say what the list actually is, "22 reports captured"
                    above a 6-row list read as disagreeing numbers
                    (UI audit #11). */}
                <div className="fh-build-eyebrow">
                  {loading || failed
                    ? 'Latest reports'
                    : <>Report history · {cockpitStats.total.toLocaleString()} {countNoun(cockpitStats.total, 'report')}</>}
                </div>
              </header>

              {!failed && <div style={{ padding: '0 16px' }}>{historySearch}</div>}

              {failed && readError}
              {loading && (
                <div className="fh-build-table__empty">Loading reports…</div>
              )}
              {!loading && !failed && recent.length === 0 && (
                <div className="fh-build-table__empty">{historyQuery ? 'No reports match your search. Try another word, job or address.' : 'No reports yet, start one above.'}</div>
              )}
              {!loading && recent.map((n: any) => {
                const linkedJob = contacts.find((c) => c.id === n.contact_id)
                const p = asParsed(n.parsed)
                const hasParsed = !!(p && (p.summary || p.action_items?.length || p.risks?.length))
                const hasRisk = !!(p?.risks?.length)
                const body = (n.text || n.body || n.title || '').toString()
                return (
                  <div key={n.id} className="fh-build-note-row">
                    <div className="fh-build-note-row__main">
                      <div className="fh-build-note-row__badges">
                        {hasParsed && <span className="fh-build-chip is-gold"><Sparkles size={10} /> Parsed</span>}
                        {hasRisk && <span className="fh-build-chip is-warn"><AlertTriangle size={10} /> Risk</span>}
                        {linkedJob && (
                          <button type="button" className="fh-build-chip is-link" onClick={() => onOpenJob(linkedJob.id)} style={{ whiteSpace: 'normal', maxWidth: '100%', textAlign: 'left', overflowWrap: 'anywhere' }}>
                            <LinkIcon size={10} /> {reportJobLabel(linkedJob)}
                          </button>
                        )}
                        {!linkedJob && <span className="fh-build-chip is-muted">{n.contact_id ? (contactsReady ? 'Linked job unavailable' : 'Job details not loaded') : 'Unlinked'}</span>}
                        <span className="fh-build-note-row__time">{relTime(n.created_at)}</span>
                      </div>
                      <p className="fh-build-note-row__body">{body || '(empty report)'}</p>
                      <ReportDetails report={n} />
                    </div>
                    <div className="fh-build-note-row__actions">
                      <button type="button" className="fh-build-icon-action" onClick={() => onMarkDone(n.id)} title="Archive" aria-label="Archive report">
                        <CheckCircle2 size={14} />
                      </button>
                      <button type="button" className="fh-build-icon-action is-danger" onClick={() => onDelete(n.id)} title="Delete" aria-label="Delete report">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}

              {!loading && !failed && <div style={{ padding: '0 16px' }}>{historyMore}</div>}
            </section>
          </div>

          {/* The rail's counts and all clear lines wait for a read that works. */}
          {!failed && (
            <aside className="fh-build-rail fh-build-rail--page">
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Reports in 24h</div>
                {loading ? railPending : (
                  <>
                    <strong>{cockpitStats.recent24}</strong>
                    <span>captured in last 24h</span>
                  </>
                )}
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">AI parsed</div>
                {loading ? railPending : (
                  <>
                    <strong>{cockpitStats.parsedCount}</strong>
                    <span>across all reports</span>
                  </>
                )}
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Reports with flagged risks</div>
                {loading ? railPending : (
                  <>
                    <strong style={{ color: cockpitStats.riskCount > 0 ? 'var(--v3-danger-text)' : undefined }}>
                      {cockpitStats.riskCount}
                    </strong>
                    <span>{cockpitStats.riskCount > 0 ? 'Across all report history' : 'No risks recorded across report history'}</span>
                    {cockpitStats.riskCount > 0 && <div className="fh-build-spark is-red" />}
                  </>
                )}
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Missing job links</div>
                {loading ? railPending : (
                  <>
                    <strong style={{ color: unlinkedCount > 0 ? 'var(--v3-primary-text)' : undefined }}>{unlinkedCount}</strong>
                    <span>{unlinkedCount > 0 ? 'Across all report history' : 'All reports carry a job link'}</span>
                    {unlinkedCount > 0 && <button type="button" className="fh-build-inline-link" onClick={onShowUnlinked} style={{ minHeight: 44 }}>Review unlinked reports</button>}
                  </>
                )}
              </section>

              {actionItems.length > 0 && (
                <section className="fh-build-rail-card">
                  <div className="fh-build-eyebrow">Action items</div>
                  <ul className="fh-build-rail-list" style={{ marginTop: 10 }}>
                    {actionItems.slice(0, 4).map((it, i) => (
                      <li key={i} style={{ gridTemplateColumns: '1fr' }}>
                        <span className="fh-build-rail-list__title" title={it.text}>{it.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          )}
        </section>
      </div>
    </div>
  )
}

