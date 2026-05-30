// SnowNotesBuild — desktop /notes in the Build direction.
//
// Drop-in for SnowNotes at >=900px. Treats notes as field intelligence
// and job documentation, not a journal.
//
// Layout:
//   Topbar
//   Hero (title + Capture panel + KPIs)
//   Two-column main: Capture+Reports feed (left) | Signal rail (right)

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

type Contact = { id: string; name?: string | null }
type Note = {
  id: string
  body?: string | null
  title?: string | null
  contact_id?: string | null
  created_at?: string | null
  parsed?: {
    summary?: string
    action_items?: string[]
    risks?: string[]
    follow_up_date?: string
    materials_needed?: string[]
  }
}

type Props = {
  loading: boolean
  contacts: Contact[]
  recent: Note[]
  linkedGroups: { contactId: string; name: string; items: Note[] }[]
  actionItems: { noteId: string; contactId: string | null; text: string; when: string | null }[]
  cockpitStats: { total: number; recent24: number; parsedCount: number; riskCount: number }
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
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SnowNotesBuild(props: Props) {
  const {
    loading, contacts, recent, actionItems, cockpitStats,
    draft, setDraft, contactId, setContactId,
    saving, parsing, parsed, parseError,
    voiceState, onStartVoice, onStopVoice, onParse, onSave,
    onMarkDone, onDelete, onOpenJob,
  } = props

  const listening = !!(voiceState && (voiceState.listening || voiceState === 'listening'))
  const unlinkedCount = recent.filter((n) => !n.contact_id).length

  return (
    <div className="fh-build-page" data-build-screen="SnowNotesBuild">
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
          <span>{cockpitStats.total.toLocaleString()} reports captured</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Field Reports</div>
            <h1 className="fh-build-title">CAPTURE THE DAY.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Today's pulse</div>
            <p>
              {cockpitStats.recent24} captured in 24h ·
              {' '}{cockpitStats.parsedCount} parsed by AI
            </p>
            {cockpitStats.riskCount > 0 && (
              <p style={{ color: '#e0a141', marginTop: 6 }}>
                <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />
                {cockpitStats.riskCount} open risk{cockpitStats.riskCount === 1 ? '' : 's'} flagged
              </p>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Reports today" value={String(cockpitStats.recent24)} accent />
            <MiniMetric label="AI parsed" value={String(cockpitStats.parsedCount)} />
            <MiniMetric label="Open risks" value={String(cockpitStats.riskCount)} tone={cockpitStats.riskCount > 0 ? 'warn' : undefined} />
            <MiniMetric label="Missing job link" value={String(unlinkedCount)} tone={unlinkedCount > 0 ? 'warn' : undefined} />
          </div>
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
                  className="fh-build-capture__textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="What happened on site? Speak or type — AI will pull out action items, risks, and materials."
                  rows={4}
                />

                <div className="fh-build-capture__row">
                  <label className="fh-build-capture__label">
                    <LinkIcon size={12} /> Link to job
                  </label>
                  <select
                    className="fh-build-select"
                    value={contactId || ''}
                    onChange={(e) => setContactId(e.target.value)}
                  >
                    <option value="">— Unlinked —</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name || 'Unnamed'}</option>
                    ))}
                  </select>
                </div>

                {parseError && (
                  <div className="fh-build-capture__error">{parseError}</div>
                )}

                {parsed && (
                  <div className="fh-build-capture__parsed">
                    <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary, #c9963a)' }}>AI parse preview</div>
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
            <section className="fh-build-card fh-build-table fh-build-notes-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Recent reports · {recent.length.toLocaleString()}</div>
              </header>

              {loading && (
                <div className="fh-build-table__empty">Loading reports…</div>
              )}
              {!loading && recent.length === 0 && (
                <div className="fh-build-table__empty">No reports yet — start one above.</div>
              )}
              {!loading && recent.slice(0, 25).map((n: any) => {
                const linkedJob = contacts.find((c) => c.id === n.contact_id)
                const hasParsed = !!(n.parsed && (n.parsed.summary || n.parsed.action_items?.length || n.parsed.risks?.length))
                const hasRisk = !!(n.parsed?.risks?.length)
                const body = (n.body || n.title || '').toString()
                return (
                  <div key={n.id} className="fh-build-note-row">
                    <div className="fh-build-note-row__main">
                      <div className="fh-build-note-row__badges">
                        {hasParsed && <span className="fh-build-chip is-gold"><Sparkles size={10} /> Parsed</span>}
                        {hasRisk && <span className="fh-build-chip is-warn"><AlertTriangle size={10} /> Risk</span>}
                        {linkedJob && (
                          <button type="button" className="fh-build-chip is-link" onClick={() => onOpenJob(linkedJob.id)}>
                            <LinkIcon size={10} /> {linkedJob.name}
                          </button>
                        )}
                        {!linkedJob && <span className="fh-build-chip is-muted">Unlinked</span>}
                        <span className="fh-build-note-row__time">{relTime(n.created_at)}</span>
                      </div>
                      <p className="fh-build-note-row__body">{body || '(empty report)'}</p>
                    </div>
                    <div className="fh-build-note-row__actions">
                      <button type="button" className="fh-build-icon-action" onClick={() => onMarkDone(n.id)} title="Archive">
                        <CheckCircle2 size={14} />
                      </button>
                      <button type="button" className="fh-build-icon-action is-danger" onClick={() => onDelete(n.id)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}

              {!loading && recent.length > 25 && (
                <div className="fh-build-table__more">
                  Showing first 25 of {recent.length.toLocaleString()}.
                </div>
              )}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Reports today</div>
              <strong>{cockpitStats.recent24}</strong>
              <span>captured in last 24h</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">AI parsed</div>
              <strong>{cockpitStats.parsedCount}</strong>
              <span>structured by AI</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Open risks</div>
              <strong style={{ color: cockpitStats.riskCount > 0 ? '#ee4942' : undefined }}>
                {cockpitStats.riskCount}
              </strong>
              <span>{cockpitStats.riskCount > 0 ? 'Needs triage' : 'All clear'}</span>
              {cockpitStats.riskCount > 0 && <div className="fh-build-spark is-red" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Missing job links</div>
              <strong style={{ color: unlinkedCount > 0 ? '#e0a141' : undefined }}>{unlinkedCount}</strong>
              <span>{unlinkedCount > 0 ? 'Tie reports to jobs' : 'All linked'}</span>
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
        </section>
      </main>
    </div>
  )
}

