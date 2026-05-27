// SnowNotes — desktop /notes in the Snow direction.
//
// Drop-in dispatch on Notes.tsx at >=900px. The mobile capture flow
// (stacked panels) flips to a cinematic desktop layout:
//   - Header strip: title + inline stats + voice button
//   - Capture studio (wide split): textarea on the left, AI output on
//     the right. When AI hasn't run, the right side shows a quiet
//     "awaiting parse" placeholder so the studio feels balanced.
//   - Timeline of recent activity (grouped by day) beside a sidebar
//     of AI action items + linked-to-jobs.
// State (draft, voice, parsed) lives in the parent screen.

import {
  Mic, MicOff, Sparkles, Trash2, AlertTriangle,
  ClipboardCheck, Package, Calendar, Briefcase,
  Activity, ChevronRight, Clock, Radio, Inbox
} from 'lucide-react'

type Note = {
  id: string | number
  text?: string | null
  body?: string | null
  contact_id?: string | null
  created_at?: string | null
  parsed?: {
    summary?: string
    action_items?: string[]
    risks?: string[]
    materials_needed?: string[]
    follow_up_date?: string | null
  } | null
  [key: string]: any
}

type Contact = { id: string; name: string | null }

type LinkedGroup = {
  contactId: string
  name: string
  items: Note[]
}

type ActionItem = {
  noteId: string | number
  contactId?: string | null
  text: any
  when?: string | null
}

type CockpitStats = {
  total: number
  recent24: number
  parsedCount: number
  riskCount: number
}

type Props = {
  loading: boolean
  contacts: Contact[]
  recent: Note[]
  linkedGroups: LinkedGroup[]
  actionItems: ActionItem[]
  cockpitStats: CockpitStats

  draft: string
  setDraft: (s: string) => void
  contactId: string
  setContactId: (s: string) => void
  saving: boolean
  parsing: boolean
  parsed: any
  parseError: string
  voiceState: string

  onStartVoice: () => void
  onStopVoice: () => void
  onParse: () => void
  onSave: () => void
  onMarkDone: (id: string | number) => void
  onDelete: (id: string | number) => void
  onOpenJob: (contactId: string) => void
}

export default function SnowNotes(props: Props) {
  const {
    loading, contacts, recent, linkedGroups, actionItems, cockpitStats,
    draft, setDraft, contactId, setContactId, saving, parsing, parsed,
    parseError, voiceState, onStartVoice, onStopVoice, onParse, onSave,
    onMarkDone, onDelete, onOpenJob,
  } = props

  const listening = voiceState === 'listening'
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0

  // Group recent activity by day bucket
  const grouped = groupByDay(recent)

  return (
    <div style={{ padding: '24px 8px 56px', color: 'var(--v3-text)' }}>

      {/* HEADER STRIP =================================================== */}
      <header style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 24,
        paddingBottom: 18,
        borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={eyebrowStyle}>Field log</div>
          <h1 style={{ margin: '6px 0 14px', fontFamily: 'var(--font-display)', fontSize: 38, lineHeight: 1, letterSpacing: '0.005em', color: 'var(--v3-text)' }}>
            Field <span style={{ color: 'var(--v3-primary)' }}>notes.</span>
          </h1>

          {/* Inline stat strip — feels like an air-traffic ribbon, not 4 KPI tiles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <StatChip label="Total"    value={cockpitStats.total} />
            <StatDivider />
            <StatChip label="Last 24h" value={cockpitStats.recent24} />
            <StatDivider />
            <StatChip label="AI parsed" value={cockpitStats.parsedCount} tone="gold" />
            {cockpitStats.riskCount > 0 && (
              <>
                <StatDivider />
                <StatChip label="Open risks" value={cockpitStats.riskCount} tone="alert" />
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={listening ? onStopVoice : onStartVoice}
          aria-label={listening ? 'Stop voice capture' : 'Start voice capture'}
          style={listening ? voiceBtnActiveStyle : voiceBtnStyle}
        >
          {listening ? <MicOff size={15} /> : <Mic size={15} />}
          <span>{listening ? 'Recording' : 'Voice capture'}</span>
          {listening && (
            <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 11, marginLeft: 4 }}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} style={{
                  width: 2,
                  height: 8,
                  background: 'currentColor',
                  borderRadius: 1,
                  animation: `fh-pulse-dot 900ms ${i * 110}ms infinite ease-in-out`,
                }} />
              ))}
            </span>
          )}
        </button>
      </header>

      {/* CAPTURE STUDIO ================================================= */}
      <section style={{
        ...studioPanel,
        borderColor: listening
          ? 'color-mix(in srgb, var(--v3-danger, #c0392b) 50%, transparent)'
          : (draft.trim() || parsed)
            ? 'color-mix(in srgb, var(--v3-primary) 30%, transparent)'
            : 'var(--v3-border, rgba(255, 240, 210, 0.10))',
        boxShadow: (draft.trim() || parsed || listening)
          ? '0 0 0 1px color-mix(in srgb, var(--v3-primary) 10%, transparent), 0 12px 32px rgba(0, 0, 0, 0.35)'
          : '0 8px 24px rgba(0, 0, 0, 0.25)',
        marginBottom: 28,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', minHeight: 280 }}>

          {/* LEFT: writing surface */}
          <div style={{
            padding: '22px 24px',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
            minWidth: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ ...eyebrowStyle, color: 'var(--v3-primary)' }}>The studio</span>
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: 11,
                color: 'var(--v3-text-muted)',
                fontVariantNumeric: 'tabular-nums',
                opacity: wordCount > 0 ? 1 : 0,
                transition: 'opacity 200ms ease',
              }}>
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </span>
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={listening ? 'Listening — speak freely…' : 'Notes from the site. Speak or type. AI parses out action items, risks, and materials.'}
              rows={6}
              style={{
                width: '100%',
                resize: 'none',
                flex: 1,
                minHeight: 150,
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 16,
                lineHeight: 1.55,
                outline: 'none',
                padding: '0 0 14px',
                boxSizing: 'border-box',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                aria-label="Link this note to a job"
                style={{
                  flex: '1 1 220px',
                  minWidth: 200,
                  padding: '9px 12px',
                  borderRadius: 4,
                  background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))',
                  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
                  color: 'var(--v3-text)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">— Unlinked —</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name || 'Unnamed contact'}</option>)}
              </select>

              <button
                type="button"
                onClick={onParse}
                disabled={!draft.trim() || parsing}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '9px 14px',
                  borderRadius: 4,
                  background: !draft.trim() || parsing
                    ? 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))'
                    : 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
                  border: !draft.trim() || parsing
                    ? '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))'
                    : '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                  color: !draft.trim() || parsing ? 'var(--v3-text-muted)' : 'var(--v3-primary)',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                  letterSpacing: '0.02em',
                  cursor: !draft.trim() || parsing ? 'default' : 'pointer',
                  opacity: !draft.trim() || parsing ? 0.6 : 1,
                  transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease',
                }}
              >
                <Sparkles size={13} />
                {parsing ? 'Parsing…' : 'Run AI parse'}
              </button>

              <button
                type="button"
                onClick={onSave}
                disabled={!draft.trim() || saving}
                style={{
                  ...primaryBtn,
                  opacity: !draft.trim() || saving ? 0.55 : 1,
                  cursor: !draft.trim() || saving ? 'default' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>

          {/* RIGHT: AI output panel (or placeholder) */}
          <div style={{
            padding: '22px 24px',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--v3-primary) 4%, transparent), transparent 60%)',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={12} color="var(--v3-primary)" />
                <span style={{ ...eyebrowStyle, color: 'var(--v3-primary)' }}>AI breakdown</span>
              </span>
              {parsing && (
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                  Working…
                </span>
              )}
            </div>

            {parseError && !parsed && (
              <div role="alert" style={{
                padding: '12px 14px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--v3-danger, #c0392b) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 40%, transparent)',
                fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.5,
                marginBottom: 12,
              }}>
                <div style={{ fontWeight: 700, color: 'var(--v3-danger-bright, #ff6b6b)', marginBottom: 2 }}>AI parse unavailable</div>
                <div style={{ color: 'var(--v3-text-muted)' }}>{parseError} You can still save the note as-is.</div>
              </div>
            )}

            {!parsed && !parseError && !parsing && (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'flex-start', justifyContent: 'center',
                gap: 8,
                fontFamily: 'var(--font-body)',
                color: 'var(--v3-text-muted)',
                fontSize: 13, lineHeight: 1.55,
              }}>
                <Sparkles size={20} color="var(--v3-primary)" style={{ opacity: 0.6 }} />
                <div style={{ color: 'var(--v3-text)', fontSize: 14, fontWeight: 600 }}>
                  {draft.trim() ? 'Ready when you are.' : 'Awaiting input.'}
                </div>
                <div style={{ maxWidth: 360 }}>
                  Tap <strong style={{ color: 'var(--v3-primary)' }}>Run AI parse</strong> and we'll extract the summary, action items, risks, materials, and any follow-up dates from your note.
                </div>
              </div>
            )}

            {parsing && !parsed && (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', gap: 10,
                paddingTop: 4,
              }}>
                <div className="v3-skeleton" style={{ height: 14, width: '70%', borderRadius: 4, background: 'color-mix(in srgb, var(--v3-primary) 10%, transparent)' }} />
                <div className="v3-skeleton" style={{ height: 12, width: '90%', borderRadius: 4, background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }} />
                <div className="v3-skeleton" style={{ height: 12, width: '80%', borderRadius: 4, background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }} />
                <div style={{ height: 8 }} />
                <div className="v3-skeleton" style={{ height: 10, width: '40%', borderRadius: 4, background: 'color-mix(in srgb, var(--v3-primary) 6%, transparent)' }} />
                <div className="v3-skeleton" style={{ height: 10, width: '85%', borderRadius: 4, background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }} />
              </div>
            )}

            {parsed && (
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                <p style={{
                  margin: 0,
                  fontFamily: 'var(--font-body)', fontSize: 15,
                  color: 'var(--v3-text)', lineHeight: 1.5,
                  fontWeight: 500,
                }}>
                  {parsed.summary}
                </p>

                <ParsedList title="Action items"  items={parsed.action_items}     Icon={ClipboardCheck} tone="good" />
                <ParsedList title="Risks"         items={parsed.risks}            Icon={AlertTriangle}  tone="warn" />
                <ParsedList title="Materials"     items={parsed.materials_needed} Icon={Package} />

                {parsed.follow_up_date && (
                  <div style={{
                    marginTop: 14, padding: '10px 12px', borderRadius: 4,
                    background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))',
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 25%, transparent)',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    fontFamily: 'var(--font-body)', fontSize: 12,
                  }}>
                    <Calendar size={12} color="var(--v3-primary)" />
                    <span style={{ color: 'var(--v3-text-muted)' }}>Follow up:</span>
                    <strong style={{ color: 'var(--v3-primary)' }}>{parsed.follow_up_date}</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* TIMELINE + SIDEBAR ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 20 }}>

        {/* TIMELINE ===================================== */}
        <section style={panelStyle}>
          <header style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Radio size={13} color="var(--v3-primary)" />
              <span style={eyebrowStyle}>Recent activity</span>
            </span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
              {loading ? '…' : `${recent.length} ${recent.length === 1 ? 'note' : 'notes'}`}
            </span>
          </header>

          {loading && (
            <div style={{ padding: '36px 20px', color: 'var(--v3-text-muted)', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 13 }}>
              Loading…
            </div>
          )}

          {!loading && recent.length === 0 && (
            <div style={{ padding: '48px 20px', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
              <Activity size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                Nothing logged yet.
              </div>
              <div style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>
                Use the studio above. Voice or type — both work.
              </div>
            </div>
          )}

          {!loading && recent.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              {grouped.map((group, gi) => (
                <div key={group.label} style={{ marginBottom: gi === grouped.length - 1 ? 0 : 8 }}>
                  <div style={dayHeaderStyle}>
                    <span>{group.label}</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--v3-border, rgba(255, 240, 210, 0.06))' }} />
                    <span style={{ color: 'var(--v3-text-muted)', fontWeight: 600 }}>
                      {group.items.length}
                    </span>
                  </div>
                  {group.items.map((n) => (
                    <TimelineEntry
                      key={n.id}
                      note={n}
                      contacts={contacts}
                      onOpen={() => n.contact_id && onOpenJob(n.contact_id)}
                      onArchive={() => onMarkDone(n.id)}
                      onDelete={() => onDelete(n.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SIDEBAR ===================================== */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>

          {/* AI ACTION ITEMS */}
          <section style={panelStyle}>
            <header style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={12} color="var(--v3-primary)" />
                <span style={eyebrowStyle}>Open actions</span>
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                {actionItems.length || '—'}
              </span>
            </header>

            {actionItems.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
                <Inbox size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.55 }}>
                  Parse a note above and the action items will land here.
                </div>
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {actionItems.map((a, i) => {
                  const c = contacts.find((x) => x.id === a.contactId)
                  return (
                    <li
                      key={`${a.noteId}-${i}`}
                      onClick={() => c && onOpenJob(c.id)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '12px 20px',
                        borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
                        cursor: c ? 'pointer' : 'default',
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => { if (c) e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        flexShrink: 0, marginTop: 2,
                        width: 18, height: 18, borderRadius: 4,
                        background: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                        display: 'grid', placeItems: 'center',
                      }}>
                        <ClipboardCheck size={11} color="var(--v3-primary)" />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontFamily: 'var(--font-body)', fontSize: 13,
                          color: 'var(--v3-text)', lineHeight: 1.45,
                          overflowWrap: 'anywhere',
                        }}>
                          {a.text}
                        </div>
                        {c?.name && (
                          <div style={{ marginTop: 5, fontFamily: 'var(--font-body)', fontSize: 10.5, color: 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            <Briefcase size={10} color="var(--v3-primary)" />
                            {c.name}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* LINKED TO JOBS */}
          <section style={panelStyle}>
            <header style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Briefcase size={12} color="var(--v3-primary)" />
                <span style={eyebrowStyle}>Notes by job</span>
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                {linkedGroups.length || '—'}
              </span>
            </header>

            {linkedGroups.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
                <Briefcase size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.55 }}>
                  Link a note to a job from the dropdown above. Notes will cluster here by job.
                </div>
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {linkedGroups.map((g) => (
                  <li
                    key={g.contactId}
                    onClick={() => onOpenJob(g.contactId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
                      cursor: 'pointer',
                      transition: 'background 120ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{
                      flexShrink: 0, width: 30, height: 30, borderRadius: 6,
                      background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
                      display: 'grid', placeItems: 'center',
                      fontFamily: 'var(--font-display)',
                      fontSize: 13, letterSpacing: '0.04em',
                      color: 'var(--v3-primary)',
                    }}>
                      {(g.name || '·').trim().charAt(0).toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                        color: 'var(--v3-text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {g.name}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2 }}>
                        {g.items.length} {g.items.length === 1 ? 'note' : 'notes'} on file
                      </div>
                    </div>
                    <ChevronRight size={14} color="var(--v3-text-muted)" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

// ============================================================
// COMPONENTS
// ============================================================

function StatChip({ label, value, tone }: { label: string; value: number; tone?: 'gold' | 'alert' }) {
  const color = tone === 'alert'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : tone === 'gold'
      ? 'var(--v3-primary)'
      : 'var(--v3-text)'
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 26, lineHeight: 1, letterSpacing: '0.01em',
        color,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: tone === 'alert' ? 'var(--v3-danger-bright, #ff6b6b)' : 'var(--v3-text-muted)',
      }}>
        {label}
      </span>
    </div>
  )
}

function StatDivider() {
  return <span aria-hidden="true" style={{ width: 1, height: 22, background: 'var(--v3-border, rgba(255, 240, 210, 0.10))' }} />
}

function TimelineEntry({ note, contacts, onOpen, onArchive, onDelete }: any) {
  const body = note.text || note.body || ''
  const firstLine = (body.split('\n').find((l: string) => l.trim()) || '').trim()
  const title = note.parsed?.summary || firstLine.slice(0, 120) || 'Untitled note'
  const showBodyBelow = body && body.trim() !== title.trim()
  const contact = contacts.find((c: Contact) => c.id === note.contact_id)
  const hasParsed = !!(note.parsed && (
    note.parsed.summary ||
    note.parsed.action_items?.length ||
    note.parsed.risks?.length ||
    note.parsed.follow_up_date ||
    note.parsed.materials_needed?.length
  ))
  const hasRisk = !!note.parsed?.risks?.length
  const actionCount = note.parsed?.action_items?.length || 0
  const when = formatClock(note.created_at)

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto',
        gap: 12,
        padding: '14px 20px 14px 16px',
        cursor: contact ? 'pointer' : 'default',
        transition: 'background 120ms ease',
        position: 'relative',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Time gutter */}
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--v3-text-muted)',
        whiteSpace: 'nowrap',
        paddingTop: 2,
        display: 'flex', alignItems: 'flex-start', gap: 5,
      }}>
        <Clock size={10} style={{ flexShrink: 0, marginTop: 2 }} />
        {when}
      </div>

      {/* Body */}
      <div style={{ minWidth: 0, position: 'relative', paddingLeft: 14 }}>
        {/* Spine */}
        <span aria-hidden="true" style={{
          position: 'absolute', left: 0, top: 2, bottom: 2, width: 2,
          borderRadius: 2,
          background: hasRisk
            ? 'var(--v3-danger-bright, #ff6b6b)'
            : hasParsed
              ? 'var(--v3-primary)'
              : 'var(--v3-border, rgba(255, 240, 210, 0.18))',
          boxShadow: hasParsed && !hasRisk ? '0 0 6px color-mix(in srgb, var(--v3-primary) 35%, transparent)' : 'none',
        }} />

        <h3 style={{
          margin: 0,
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
          color: 'var(--v3-text)', lineHeight: 1.35,
          overflowWrap: 'anywhere',
          display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          {title}
          {hasParsed && !hasRisk && (
            <span style={chipStyle('gold')}>
              <Sparkles size={9} />
              AI
            </span>
          )}
          {hasRisk && (
            <span style={chipStyle('alert')}>
              <AlertTriangle size={9} />
              Risk
            </span>
          )}
        </h3>

        {showBodyBelow && (
          <p style={{
            margin: '6px 0 0', fontSize: 12.5, color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)', lineHeight: 1.55,
            overflowWrap: 'anywhere',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {body}
          </p>
        )}

        {(contact?.name || actionCount > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {contact?.name && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 999,
                background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
                border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
                color: 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                <Briefcase size={10} color="var(--v3-primary)" />
                {contact.name}
              </span>
            )}
            {actionCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--v3-success, #2ecc71) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-success, #2ecc71) 30%, transparent)',
                color: 'var(--v3-success-bright, #5dd47c)',
                fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                <ClipboardCheck size={10} />
                {actionCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', gap: 2, paddingTop: 2 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onArchive() }}
          aria-label="Archive note"
          title="Archive"
          style={rowIconBtnStyle}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--v3-success-bright, #5dd47c)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--v3-success, #2ecc71) 10%, transparent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--v3-text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <ClipboardCheck size={13} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (!window.confirm('Delete this note? This cannot be undone.')) return
            onDelete()
          }}
          aria-label="Delete note"
          title="Delete"
          style={rowIconBtnStyle}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--v3-danger-bright, #ff6b6b)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--v3-danger, #c0392b) 10%, transparent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--v3-text-muted)'; e.currentTarget.style.background = 'transparent' }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function ParsedList({ title, items, Icon, tone }: any) {
  if (!items || items.length === 0) return null
  const color = tone === 'warn'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : tone === 'good'
      ? 'var(--v3-success-bright, #5dd47c)'
      : 'var(--v3-text-muted)'
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6,
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color,
      }}>
        {Icon ? <Icon size={11} /> : null}
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.55 }}>
        {items.map((it: string, i: number) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
      </ul>
    </div>
  )
}

// ============================================================
// HELPERS
// ============================================================

function groupByDay(notes: Note[]): { label: string; items: Note[] }[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const sevenAgo = new Date(today); sevenAgo.setDate(sevenAgo.getDate() - 7)

  const buckets: Record<string, Note[]> = {}
  const order: string[] = []

  for (const n of notes) {
    if (!n.created_at) {
      const k = 'Earlier'
      if (!buckets[k]) { buckets[k] = []; order.push(k) }
      buckets[k].push(n)
      continue
    }
    const d = new Date(n.created_at)
    const day = new Date(d); day.setHours(0, 0, 0, 0)
    let label: string
    if (day.getTime() === today.getTime()) label = 'Today'
    else if (day.getTime() === yesterday.getTime()) label = 'Yesterday'
    else if (day >= sevenAgo) label = d.toLocaleDateString(undefined, { weekday: 'long' })
    else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

    if (!buckets[label]) { buckets[label] = []; order.push(label) }
    buckets[label].push(n)
  }

  return order.map((l) => ({ label: l, items: buckets[l] }))
}

function formatClock(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function chipStyle(tone: 'gold' | 'alert'): React.CSSProperties {
  const isAlert = tone === 'alert'
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '2px 7px', borderRadius: 999,
    background: isAlert
      ? 'color-mix(in srgb, var(--v3-danger, #c0392b) 14%, transparent)'
      : 'color-mix(in srgb, var(--v3-primary) 12%, transparent)',
    border: isAlert
      ? '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 40%, transparent)'
      : '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
    color: isAlert ? 'var(--v3-danger-bright, #ff6b6b)' : 'var(--v3-primary)',
    fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.08em',
  }
}

// ============================================================
// STYLES
// ============================================================

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'var(--v3-text-muted)',
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6, overflow: 'hidden',
}

const studioPanel: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6,
  overflow: 'hidden',
  transition: 'border-color 220ms ease, box-shadow 220ms ease',
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none', borderRadius: 4, padding: '9px 18px',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)',
}

const voiceBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '11px 18px', borderRadius: 4,
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
  flexShrink: 0,
}

const voiceBtnActiveStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '11px 18px', borderRadius: 4,
  background: 'color-mix(in srgb, var(--v3-danger, #c0392b) 14%, transparent)',
  border: '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 45%, transparent)',
  color: 'var(--v3-danger-bright, #ff6b6b)',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
  flexShrink: 0,
  boxShadow: '0 0 0 4px color-mix(in srgb, var(--v3-danger, #c0392b) 10%, transparent)',
}

const dayHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 20px 8px',
  fontFamily: 'var(--font-body)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--v3-primary)',
}

const rowIconBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'grid', placeItems: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  color: 'var(--v3-text-muted)',
  cursor: 'pointer',
  transition: 'color 120ms ease, background 120ms ease',
}
