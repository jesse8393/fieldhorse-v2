// SnowNotes — desktop /notes in the Snow direction.
//
// Drop-in dispatch on Notes.tsx at >=900px. The mobile capture flow
// (stacked panels) flips to a two-column desktop layout: capture +
// recent activity on the left, AI action items + linked-to-jobs on
// the right. State (draft, voice, parsed) lives in the parent screen
// and is passed in as props — this component is purely presentational.

import {
  Mic, MicOff, Sparkles, Trash2, AlertTriangle,
  ClipboardCheck, Package, Calendar, Briefcase,
  Activity, ChevronRight, Clock
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

  // capture form state (lives in parent)
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

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================ */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>
            Field log · {cockpitStats.total} {cockpitStats.total === 1 ? 'note' : 'notes'}
            {cockpitStats.recent24 > 0 && ` · ${cockpitStats.recent24} in last 24h`}
          </div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
            Field <span style={{ color: 'var(--v3-primary)' }}>notes</span>
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={listening ? onStopVoice : onStartVoice}
            aria-label={listening ? 'Stop voice capture' : 'Start voice capture'}
            style={listening ? voiceBtnActiveStyle : voiceBtnStyle}
          >
            {listening ? <MicOff size={14} /> : <Mic size={14} />}
            {listening ? 'Stop recording' : 'Voice capture'}
          </button>
        </div>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Total notes"  value={String(cockpitStats.total)} />
        <KPITile label="Last 24 hours" value={String(cockpitStats.recent24)} sub={cockpitStats.recent24 > 0 ? 'fresh activity' : 'quiet day'} />
        <KPITile label="AI parsed"    value={String(cockpitStats.parsedCount)} accent sub={cockpitStats.parsedCount === cockpitStats.total && cockpitStats.total > 0 ? 'all caught up' : `${cockpitStats.total - cockpitStats.parsedCount} unprocessed`} />
        <KPITile label="Open risks"   value={String(cockpitStats.riskCount)} tone={cockpitStats.riskCount > 0 ? 'alert' : 'default'} sub={cockpitStats.riskCount > 0 ? 'needs triage' : 'none flagged'} />
      </div>

      {/* TWO-COLUMN LAYOUT ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 16 }}>

        {/* ─── LEFT: CAPTURE + RECENT ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          {/* CAPTURE PANEL */}
          <section style={{
            ...panelStyle,
            padding: 18,
            borderColor: listening
              ? 'color-mix(in srgb, var(--v3-danger, #c0392b) 45%, transparent)'
              : 'var(--v3-border, rgba(255, 240, 210, 0.10))'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={eyebrowStyle}>Capture a note</span>
              {listening && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--v3-danger-bright, #ff6b6b)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--v3-danger-bright, #ff6b6b)', animation: 'fh-pulse-dot 900ms infinite ease-in-out' }} />
                  Listening
                </span>
              )}
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={listening ? 'Listening — speak freely…' : 'What happened on site? Speak or type. AI parses out action items, risks, materials.'}
              rows={4}
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 108,
                background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))',
                border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
                borderRadius: 4,
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                lineHeight: 1.55,
                outline: 'none',
                padding: '12px 14px',
                boxSizing: 'border-box',
              }}
            />

            {/* Action row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
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
                <option value="">— No job link —</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    : 'color-mix(in srgb, var(--v3-primary) 12%, transparent)',
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
                {parsing ? 'Parsing…' : 'AI parse'}
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

            {/* Parse error */}
            {parseError && !parsed && (
              <div role="alert" style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 4,
                background: 'color-mix(in srgb, var(--v3-danger, #c0392b) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 40%, transparent)',
                fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.45,
              }}>
                <span style={{ fontWeight: 700, color: 'var(--v3-danger-bright, #ff6b6b)' }}>AI parse unavailable. </span>
                <span style={{ color: 'var(--v3-text-muted)' }}>{parseError} You can still save the note as-is.</span>
              </div>
            )}

            {/* AI summary preview */}
            {parsed && (
              <div style={{
                marginTop: 12, padding: 14, borderRadius: 4,
                background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 25%, transparent)',
              }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Sparkles size={12} color="var(--v3-primary)" />
                  <span style={{ ...eyebrowStyle, color: 'var(--v3-primary)' }}>AI Summary</span>
                </div>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                  {parsed.summary}
                </p>
                <ParsedList title="Action items" items={parsed.action_items} Icon={ClipboardCheck} tone="good" />
                <ParsedList title="Risks" items={parsed.risks} Icon={AlertTriangle} tone="warn" />
                <ParsedList title="Materials" items={parsed.materials_needed} Icon={Package} />
                {parsed.follow_up_date && (
                  <p style={{ margin: '10px 0 0', fontSize: 12, fontFamily: 'var(--font-body)', color: 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={12} />
                    Follow up: <strong style={{ color: 'var(--v3-primary)' }}>{parsed.follow_up_date}</strong>
                  </p>
                )}
              </div>
            )}
          </section>

          {/* RECENT ACTIVITY */}
          <section style={panelStyle}>
            <div style={{ padding: '14px 18px 8px', borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={eyebrowStyle}>Recent activity</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                {recent.length === 0 ? '—' : `Showing ${recent.length}`}
              </span>
            </div>

            {loading && (
              <div style={{ padding: '32px 18px', color: 'var(--v3-text-muted)', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                Loading…
              </div>
            )}

            {!loading && recent.length === 0 && (
              <div style={{ padding: '40px 18px', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
                <Activity size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                  Nothing logged yet.
                </div>
                <div style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>
                  Use the capture above. Voice or type — both work.
                </div>
              </div>
            )}

            {!loading && recent.length > 0 && (
              <div>
                {recent.map((n, idx) => (
                  <NoteRow
                    key={n.id}
                    note={n}
                    contacts={contacts}
                    isLast={idx === recent.length - 1}
                    onOpen={() => n.contact_id && onOpenJob(n.contact_id)}
                    onArchive={() => onMarkDone(n.id)}
                    onDelete={() => onDelete(n.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ─── RIGHT: AI ACTIONS + LINKED JOBS ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

          {/* AI ACTION ITEMS */}
          <section style={panelStyle}>
            <div style={{ padding: '14px 18px 8px', borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={12} color="var(--v3-primary)" />
                <span style={eyebrowStyle}>AI action items</span>
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                {actionItems.length || '—'}
              </span>
            </div>

            {actionItems.length === 0 ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
                <ClipboardCheck size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.5 }}>
                  Tap <strong style={{ color: 'var(--v3-primary)' }}>AI parse</strong> on a note to extract action items.
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
                        padding: '12px 18px',
                        borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
                        cursor: c ? 'pointer' : 'default',
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => { if (c) e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        flexShrink: 0, marginTop: 2,
                        width: 16, height: 16, borderRadius: 4,
                        background: 'color-mix(in srgb, var(--v3-primary) 12%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                        display: 'grid', placeItems: 'center',
                      }}>
                        <ClipboardCheck size={10} color="var(--v3-primary)" />
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
                          <div style={{ marginTop: 4, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
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
            <div style={{ padding: '14px 18px 8px', borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={eyebrowStyle}>Linked to jobs</span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                {linkedGroups.length || '—'}
              </span>
            </div>

            {linkedGroups.length === 0 ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
                <Briefcase size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.5 }}>
                  Pick a job from the dropdown to link a note. They'll cluster here.
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
                      padding: '12px 18px',
                      borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
                      cursor: 'pointer',
                      transition: 'background 120ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: 6,
                      background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
                      display: 'grid', placeItems: 'center',
                    }}>
                      <Briefcase size={13} color="var(--v3-primary)" />
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
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================

function KPITile({ label, value, sub, accent, tone }: any) {
  const valColor = tone === 'alert'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : accent
      ? 'var(--v3-primary)'
      : 'var(--v3-text)'
  return (
    <div style={{
      background: 'var(--v3-surface, #141110)',
      border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      borderRadius: 6, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 8,
      minHeight: 104,
    }}>
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>{sub}</span>}
    </div>
  )
}

function NoteRow({ note, contacts, isLast, onOpen, onArchive, onDelete }: any) {
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
  const when = formatRelativeTime(note.created_at)

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '14px 18px',
        borderBottom: isLast ? 'none' : '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
        cursor: contact ? 'pointer' : 'default',
        transition: 'background 120ms ease',
        position: 'relative',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Spine */}
      <span aria-hidden="true" style={{
        position: 'absolute', left: 0, top: 14, bottom: 14, width: 2,
        background: hasRisk
          ? 'var(--v3-danger-bright, #ff6b6b)'
          : hasParsed
            ? 'var(--v3-primary)'
            : 'transparent',
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{
            margin: 0,
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
            color: 'var(--v3-text)', lineHeight: 1.35,
            overflowWrap: 'anywhere',
            display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            {title}
            {hasParsed && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--v3-primary) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                color: 'var(--v3-primary)',
                fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.08em',
              }}>
                <Sparkles size={9} />
                AI
              </span>
            )}
            {hasRisk && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 999,
                background: 'color-mix(in srgb, var(--v3-danger, #c0392b) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 40%, transparent)',
                color: 'var(--v3-danger-bright, #ff6b6b)',
                fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.08em',
              }}>
                <AlertTriangle size={9} />
                RISK
              </span>
            )}
          </h3>
          <span style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: 'var(--font-body)', fontSize: 11,
            color: 'var(--v3-text-muted)', whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <Clock size={10} />
            {when}
          </span>
        </div>

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
                {actionCount} {actionCount === 1 ? 'action' : 'actions'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Row actions */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
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
    <div style={{ marginTop: 10 }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6,
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.10em', textTransform: 'uppercase',
        color,
      }}>
        {Icon ? <Icon size={11} /> : null}
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
        {items.map((it: string, i: number) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
      </ul>
    </div>
  )
}

function formatRelativeTime(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'Yesterday'
  if (diffD < 7) return `${diffD}d ago`
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
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

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none', borderRadius: 4, padding: '9px 16px',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)',
}

const voiceBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 4,
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
}

const voiceBtnActiveStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 4,
  background: 'color-mix(in srgb, var(--v3-danger, #c0392b) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 45%, transparent)',
  color: 'var(--v3-danger-bright, #ff6b6b)',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
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
