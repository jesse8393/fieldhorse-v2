// src/components/CaptureSheet.tsx
//
// Universal Capture — the one gesture that replaces navigating the app
// to do data entry. Opened from anywhere (gold FAB, Cmd/Ctrl+J, command
// palette) via the `fh:open-capture` window event. The contractor says
// it, types it, or snaps a receipt; Claude routes it into the right
// action (note / to-do / payment / expense / schedule / lead) matched
// to the right job; the operator confirms one editable card; one tap
// writes it through the same helpers the rest of the app uses.
//
// Failure philosophy: capture must never lose words. AI down → offer
// "save as note". No signal → queue in the offline outbox and sync as
// a note when the connection returns.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, ReceiptText, Sparkles, X, Check, StickyNote } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { hapticTap, hapticSuccess, hapticError } from '../lib/haptics.ts'
import { toastSuccess, toastError, toastInfo } from '../lib/toast.ts'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import { ACTIVE_STAGES } from '../lib/stages.ts'
import {
  routeCapture, normalizeIntent, CAPTURE_KIND_META,
  EXPENSE_CATEGORIES, PAYMENT_KINDS,
  type CaptureIntent
} from '../lib/captureIntelligence.ts'
import { commitCapture, type CaptureContact } from '../lib/captureActions.ts'
import { pushOutbox, flushOutbox, outboxCount } from '../lib/captureOutbox.ts'
import { compressImageToDataUrl, parseExpenseFromImage } from '../lib/docIntelligence.ts'

type Phase = 'input' | 'parsing' | 'confirm' | 'saving'

export default function CaptureSheet() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [intent, setIntent] = useState<CaptureIntent | null>(null)
  const [contacts, setContacts] = useState<CaptureContact[]>([])
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  /* ── open via global event + Cmd/Ctrl+J ─────────────────── */
  useEffect(() => {
    function onOpen() { setOpen(true) }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('fh:open-capture', onOpen as EventListener)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('fh:open-capture', onOpen as EventListener)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  /* ── offline outbox: sync queued captures when we can ──────── */
  const flush = useCallback(async () => {
    if (!user?.id || !navigator.onLine || outboxCount() === 0) return
    const n = await flushOutbox(user.id)
    if (n > 0) toastSuccess(`Synced ${n} offline capture${n === 1 ? '' : 's'}`, 'Saved to Notes')
  }, [user?.id])

  useEffect(() => {
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [flush])

  /* ── roster: active leads + jobs for matching ──────────────── */
  useEffect(() => {
    if (!open || !user) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('fh_contacts')
        .select('id,user_id,name,job_title,stage,amount')
        .in('stage', ACTIVE_STAGES)
        .order('updated_at', { ascending: false })
        .limit(100)
      if (alive && data) setContacts(data as CaptureContact[])
    })()
    return () => { alive = false }
  }, [open, user])

  function reset() {
    stopVoice()
    setPhase('input')
    setText('')
    setIntent(null)
  }

  function close() {
    if (phase === 'saving') return
    setOpen(false)
    reset()
  }

  /* ── voice ─────────────────────────────────────────────────── */
  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      toastInfo('Voice not supported here', 'Type it instead — same magic.')
      return
    }
    hapticTap()
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let final = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      setText((final + interim).trim())
    }
    rec.onend = () => {
      setListening(false)
      recRef.current = null
      // Voice flows straight into the parse — say it, see the card.
      const spoken = (final || '').trim()
      if (spoken) submit(spoken)
    }
    rec.onerror = () => {
      setListening(false)
      recRef.current = null
    }
    recRef.current = rec
    setText('')
    setListening(true)
    rec.start()
  }

  function stopVoice() {
    try { recRef.current?.stop() } catch {}
    recRef.current = null
    setListening(false)
  }

  /* ── receipt snap → expense intent ─────────────────────────── */
  async function onReceiptPicked(file: File | null) {
    if (!file || !user) return
    hapticTap()
    setPhase('parsing')
    try {
      const dataUrl = await compressImageToDataUrl(file)
      const parsed = await parseExpenseFromImage(dataUrl)
      const next = normalizeIntent({ kind: 'expense', confidence: 0.8, ...parsed }, contacts)
      if (!next) throw new Error('Could not read that receipt')
      setIntent(next)
      setPhase('confirm')
    } catch (e: any) {
      hapticError()
      toastError("Couldn't read the receipt", e?.message || 'Add it by voice or text instead.')
      setPhase('input')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* ── parse ─────────────────────────────────────────────────── */
  async function submit(raw?: string) {
    const input = (raw ?? text).trim()
    if (!input || phase === 'parsing' || phase === 'saving' || !user) return
    stopVoice()

    if (!navigator.onLine) {
      pushOutbox(input)
      hapticSuccess()
      toastSuccess('Captured offline', "It'll sync as a note when you're back in signal.")
      close()
      return
    }

    setText(input)
    setPhase('parsing')
    try {
      const next = await routeCapture({ text: input, roster: contacts })
      setIntent(next)
      setPhase('confirm')
      hapticTap()
    } catch {
      // AI unavailable — words still must not be lost.
      setIntent({ kind: 'note', summary: 'Save a note', job_id: null, confidence: 0, text: input })
      setPhase('confirm')
    }
  }

  /* ── commit ────────────────────────────────────────────────── */
  async function save(forced?: CaptureIntent) {
    const it = forced ?? intent
    if (!it || !user || phase === 'saving') return
    setPhase('saving')
    try {
      const result = await commitCapture({ intent: it, userId: user.id, contacts })
      hapticSuccess()
      toastSuccess(result.toast, it.summary)
      setOpen(false)
      reset()
      // Deliberately no auto-navigation — capture is fire-and-forget;
      // the operator stays on whatever screen they were working in.
      void result.link
    } catch (e: any) {
      hapticError()
      toastError("Couldn't save that", e?.message || 'Try again.')
      setPhase('confirm')
    }
  }

  function saveAsNote() {
    const body = intent?.text || intent?.description || text
    if (!body) return
    save({ kind: 'note', summary: 'Save a note', job_id: intent?.job_id ?? null, confidence: 1, text: body })
  }

  function patch(p: Partial<CaptureIntent>) {
    setIntent((cur) => (cur ? { ...cur, ...p } : cur))
  }

  /* ── styles (match SendInvoiceSheet conventions) ───────────── */
  const labelStyle: import('react').CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: 'var(--ink-muted)'
  }
  const fieldStyle: import('react').CSSProperties = {
    padding: '11px 14px', borderRadius: 12,
    background: 'var(--surface-2)', border: '1px solid var(--rule)',
    color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14,
    outline: 'none', width: '100%', boxSizing: 'border-box',
    scrollMarginTop: 96, scrollMarginBottom: 120
  }

  const meta = intent ? CAPTURE_KIND_META[intent.kind] : null
  const busy = phase === 'parsing' || phase === 'saving'
  const saving = phase === 'saving'
  // The confirm card stays mounted while the save is in flight.
  const inConfirm = phase === 'confirm' || phase === 'saving'

  return (
    <Drawer open={open} onOpenChange={(v: any) => { if (!v) close() }}>
      <DrawerContent className="ui:max-w-full ui:overflow-x-hidden" style={drawerStyle}>
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(245, 242, 234, 0.62)' }}>
            <Sparkles size={12} />
            Capture
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              {inConfirm ? 'Look right?' : 'Just say it.'}
            </h2>
          </DrawerTitle>
          <DrawerDescription style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
            {inConfirm
              ? 'One tap files it. Edit anything first.'
              : 'Payments, expenses, to-dos, leads, appointments, notes — Fieldhorse files it on the right job.'}
          </DrawerDescription>
        </DrawerHeader>

        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); inConfirm ? save() : submit() }} style={formStyle({ gap: 14 })}>

          {!inConfirm && (
            <>
              {/* Mic — the headline gesture */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '6px 0 2px' }}>
                <button
                  type="button"
                  onClick={() => (listening ? stopVoice() : startVoice())}
                  disabled={phase === 'parsing'}
                  aria-label={listening ? 'Stop listening' : 'Start voice capture'}
                  style={{
                    width: 84, height: 84, borderRadius: 999, cursor: 'pointer',
                    display: 'grid', placeItems: 'center',
                    border: listening ? '1px solid var(--v3-primary)' : '1px solid var(--rule)',
                    background: listening
                      ? 'color-mix(in srgb, var(--v3-primary) 18%, var(--surface-2))'
                      : 'var(--surface-2)',
                    color: listening ? 'var(--v3-primary)' : 'var(--ink-strong)',
                    boxShadow: listening ? '0 0 0 8px color-mix(in srgb, var(--v3-primary) 12%, transparent)' : 'none',
                    transition: 'box-shadow 200ms ease, background 200ms ease',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  {listening ? <Square size={26} /> : <Mic size={30} />}
                </button>
                <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
                  {phase === 'parsing' ? 'Filing it…' : listening ? 'Listening — tap to finish' : 'Tap to talk'}
                </span>
              </div>

              {/* Text fallback */}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'"Got a $2,500 deposit check from Henderson"\n"Remind me to call the inspector Friday"\n"New lead — Mike Salas, 615-555-0114, deck rebuild"'}
                rows={3}
                disabled={busy || listening}
                style={{ ...fieldStyle, resize: 'none', lineHeight: 1.5 }}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  style={{
                    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    background: 'var(--surface-2)', border: '1px solid var(--rule)',
                    color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600
                  }}
                >
                  <ReceiptText size={15} />
                  Snap a receipt
                </button>
                <button
                  type="submit"
                  disabled={busy || listening || !text.trim()}
                  style={{
                    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    background: text.trim() && !busy ? 'var(--v3-primary)' : 'var(--surface-2)',
                    border: '1px solid var(--rule)',
                    color: text.trim() && !busy ? '#141110' : 'var(--ink-muted)',
                    fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700
                  }}
                >
                  <Sparkles size={15} />
                  {phase === 'parsing' ? 'Filing…' : 'File it'}
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onReceiptPicked(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
            </>
          )}

          {inConfirm && intent && meta && (
            <>
              {/* The parsed action card */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                padding: '14px 14px 16px', borderRadius: 14,
                background: 'var(--surface-2)', border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, var(--rule))'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 999,
                    background: 'color-mix(in srgb, var(--v3-primary) 16%, transparent)',
                    color: 'var(--v3-primary)', fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase'
                  }}>
                    {meta.label}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {intent.summary}
                  </span>
                  <button type="button" onClick={reset} aria-label="Start over" style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', padding: 4 }}>
                    <X size={15} />
                  </button>
                </div>

                {/* Job attach — every kind except lead */}
                {intent.kind !== 'lead' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={labelStyle}>Job</span>
                    <select
                      value={intent.job_id || ''}
                      onChange={(e) => patch({ job_id: e.target.value || null })}
                      style={{ ...fieldStyle, appearance: 'none' }}
                    >
                      <option value="">No job — general</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || 'Unnamed'}{c.job_title ? ` — ${c.job_title}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {(intent.kind === 'note' || intent.kind === 'todo') && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={labelStyle}>{intent.kind === 'todo' ? 'To-do' : 'Note'}</span>
                    <textarea
                      value={intent.text || ''}
                      onChange={(e) => patch({ text: e.target.value })}
                      rows={3}
                      style={{ ...fieldStyle, resize: 'none', lineHeight: 1.5 }}
                    />
                  </label>
                )}

                {intent.kind === 'todo' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={labelStyle}>Due</span>
                    <input type="date" value={intent.due_at || ''} onChange={(e) => patch({ due_at: e.target.value || null })} style={fieldStyle} />
                  </label>
                )}

                {(intent.kind === 'payment' || intent.kind === 'expense') && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={labelStyle}>Amount</span>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', fontSize: 14 }}>$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={intent.amount ?? ''}
                          onChange={(e) => patch({ amount: Number(e.target.value.replace(/[^0-9.]/g, '')) || null })}
                          style={{ ...fieldStyle, paddingLeft: 26 }}
                        />
                      </div>
                    </label>
                    {intent.kind === 'payment' ? (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={labelStyle}>For</span>
                        <select value={intent.payment_kind || 'other'} onChange={(e) => patch({ payment_kind: e.target.value })} style={{ ...fieldStyle, appearance: 'none' }}>
                          {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
                        </select>
                      </label>
                    ) : (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={labelStyle}>Category</span>
                        <select value={intent.category || 'Other'} onChange={(e) => patch({ category: e.target.value })} style={{ ...fieldStyle, appearance: 'none' }}>
                          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                )}

                {intent.kind === 'expense' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={labelStyle}>What for</span>
                    <input type="text" value={intent.description || ''} onChange={(e) => patch({ description: e.target.value })} style={fieldStyle} />
                  </label>
                )}

                {intent.kind === 'schedule' && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={labelStyle}>Title</span>
                      <input type="text" value={intent.title || ''} onChange={(e) => patch({ title: e.target.value })} style={fieldStyle} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={labelStyle}>When</span>
                      <input
                        type="datetime-local"
                        value={isoToLocalInput(intent.start_at)}
                        onChange={(e) => {
                          const start = e.target.value ? new Date(e.target.value).toISOString() : null
                          patch({
                            start_at: start,
                            end_at: start ? new Date(Date.parse(start) + 60 * 60 * 1000).toISOString() : null
                          })
                        }}
                        style={fieldStyle}
                      />
                    </label>
                  </>
                )}

                {intent.kind === 'lead' && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={labelStyle}>Name</span>
                        <input type="text" value={intent.name || ''} onChange={(e) => patch({ name: e.target.value })} style={fieldStyle} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={labelStyle}>Phone</span>
                        <input type="tel" value={intent.phone || ''} onChange={(e) => patch({ phone: e.target.value })} style={fieldStyle} />
                      </label>
                    </div>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={labelStyle}>Job</span>
                      <input type="text" value={intent.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Deck rebuild" style={fieldStyle} />
                    </label>
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                  background: 'var(--v3-primary)', border: 'none',
                  color: '#141110', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700
                }}
              >
                <Check size={16} />
                {saving ? 'Saving…' : meta.verb}
              </button>

              {intent.kind !== 'note' && (
                <button
                  type="button"
                  onClick={saveAsNote}
                  disabled={saving}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '10px 16px', borderRadius: 12, cursor: 'pointer',
                    background: 'transparent', border: '1px solid var(--rule)',
                    color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600
                  }}
                >
                  <StickyNote size={14} />
                  Just save it as a note
                </button>
              )}
            </>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  )
}

// ISO (UTC) → value for <input type="datetime-local"> in local time.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
