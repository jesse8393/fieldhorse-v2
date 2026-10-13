// One conversation (spec 9.8, render base/inbox.jpg): a header with the
// customer's name, a chip for their job and a call button; the messages as
// bubbles under Yesterday and Today style labels, sent ones in ink with
// linen text on the right and received ones on paper on the left; an AI
// draft panel when an agent has proposed a reply; and a composer with
// dictation and a dark send button.
//
// Trust rules. Nothing leaves without a tap, and a tap sends now or never:
//   * Opening a thread only reads it, and marks it read once, and only
//     when the conversation is in the active company.
//   * The draft panel is draft mode only: "Draft reply" in a text area the
//     person can edit, a line that says how it will go out, a brushed gold
//     "Send" that approves it with the text as it stands
//     (fh_agent_run_approve, p_body), and a quiet "Discard". Send is the
//     one gold action on the screen, and it waits until the drafts were
//     read from the server after the screen opened. A draft written before
//     the customer's newest message is folded under "Older draft".
//   * The composer sends through fh_send_message only from its own button.
//   * With no signal, Send says "No signal. Nothing was sent." and keeps
//     the words. Nothing is queued to go out later.
//   * When a send fails, the thread is read again and Send waits for that
//     read, because the message may have gone out anyway.
//   * A held message never looks sent. It is drawn as an outline with the
//     reason in words ("Held: outside sending hours"), and no send time.
//   * Dictation only fills the text. The person reads it and taps Send.
//     Send ends dictation first, so nothing it hears afterwards lands in
//     the field. No audio is recorded: it is the browser's
//     SpeechRecognition, used the way CaptureSheet uses it.
//   * A conversation from another company shows "Not in this company" and
//     no actions at all.
//
// Left out on purpose: the optional "also move the visit" checkbox the
// spec mentions. The phase plan does not build it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Building2, ChevronDown, ChevronLeft, Clock, HardHat, Mic, Phone, SendHorizontal, Sparkles } from 'lucide-react'
import { Button, Chip, EmptyState, Icon, IconButton, Skeleton } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useJobs, type JobRow } from '../../lib/queries.ts'
import { useHideDock } from '../../lib/dockVisibility.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { speechErrorFeedback } from '../../lib/speech.ts'
import { toastError, toastInfo } from '../../lib/toast.ts'
import {
  draftChannel,
  draftSendsLine,
  groupByDay,
  replyChannel,
  replySubject,
  stageChip,
  threadItems,
  timeLabel,
  useInboxActions,
  useThread,
  type InboxRow,
  type ReplyChannel,
  type ThreadDraftItem,
  type ThreadMessageItem
} from '../../lib/inbox.ts'
import './inbox.css'

export type ThreadProps = {
  conversationId: string
  /** The conversation's row in the inbox list, when it has loaded. */
  row: InboxRow | undefined
  /** True beside the list on a desktop: no back button, the thread scrolls inside its column. */
  embedded?: boolean
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CHANNEL_WORDS: Record<string, string> = { email: 'Email', call: 'Call', webchat: 'Web chat' }

const NO_SIGNAL = 'No signal. Nothing was sent.'
const NOT_CONFIRMED = "We couldn't confirm this went out."
const CHECK_THREAD = 'Check the thread before sending again.'

/** The job to link from the header: the customer's job at the stage the list shows, else the newest. */
function jobFor(row: InboxRow | undefined, jobs: JobRow[] | undefined): JobRow | null {
  if (!row?.client_id || !jobs) return null
  const mine = jobs.filter((j) => j.client_id === row.client_id)
  if (mine.length === 0) return null
  const sameStage = mine.filter((j) => j.stage === row.latest_stage)
  const pool = sameStage.length > 0 ? sameStage : mine
  return [...pool].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0]
}

/** Grows a text area to fit what is in it, while it is on screen. */
function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxRows = 6, active = true) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 24)}px`
  }, [ref, value, maxRows, active])
}

// The part of the browser's SpeechRecognition this screen uses.
type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

function speechCtor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Bubble({ item, name }: { item: ThreadMessageItem; name: string }) {
  const channelWord = CHANNEL_WORDS[item.channel] ?? null
  const when = timeLabel(item.at)
  return (
    <div className={`fhi-msg ${item.outgoing ? 'is-out' : 'is-in'} is-${item.state}`}>
      <div className="fhi-bubble">
        <span className="fhc-vh">{item.outgoing ? 'You said ' : `${name} said `}</span>
        {item.subject && <span className="fhi-bubble__subject">{item.subject}</span>}
        {item.body || 'No text'}
      </div>
      {item.state === 'held' ? (
        <p className="fhi-meta fhi-meta--held">
          <Icon icon={Clock} size={18} />
          <span>{item.held}</span>
        </p>
      ) : item.state === 'failed' ? (
        <p className="fhi-meta">
          <Chip label="Not delivered" tone="danger" />
        </p>
      ) : item.state === 'unsent' ? (
        <p className="fhi-meta">Not sent yet</p>
      ) : (
        <p className="fhi-meta">{channelWord ? `${when}, ${channelWord}` : when}</p>
      )}
    </div>
  )
}

type DraftPanelProps = {
  item: ThreadDraftItem
  name: string
  text: string
  /** "Sends by text to Priya Rangarajan" */
  sendsLine: string
  onChange: (text: string) => void
  onSend: () => void
  onDiscard: () => void
  sending: boolean
  discarding: boolean
  /** False until the drafts were read from the server after the screen opened. */
  ready: boolean
  /** An older draft starts folded; this opens it. */
  open: boolean
  onToggle: () => void
}

/** The agent's proposed reply. Draft mode only: editable, and nothing goes without Send. */
function DraftPanel({ item, name, text, sendsLine, onChange, onSend, onDiscard, sending, discarding, ready, open, onToggle }: DraftPanelProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const folded = item.older && !open
  useAutosize(areaRef, text, 10, !folded)
  const empty = text.trim() === ''
  return (
    <section className={`fhi-draft${item.older ? ' is-older' : ''}`} aria-label={item.older ? 'Older draft reply' : 'Draft reply'}>
      <div className="fhi-draft__head">
        <Icon icon={Sparkles} size={18} />
        {item.older ? (
          <button type="button" className="fhi-draft__toggle" aria-expanded={open} onClick={onToggle}>
            <span>Older draft</span>
            <Icon icon={ChevronDown} size={18} />
          </button>
        ) : (
          <p className="fhi-draft__label">Draft reply</p>
        )}
        {!folded && (
          <Button
            variant="quiet"
            size="mini"
            aria-label="Edit the draft reply"
            onClick={() => {
              const el = areaRef.current
              if (!el) return
              el.focus()
              el.setSelectionRange(el.value.length, el.value.length)
            }}
          >
            Edit
          </Button>
        )}
      </div>
      {item.older && <p className="fhi-draft__note">Written before {name} last wrote.</p>}
      {!folded && (
        <>
          <textarea
            ref={areaRef}
            className="fhi-draft__text"
            aria-label="Draft reply"
            rows={3}
            value={text}
            readOnly={sending}
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="fhi-draft__via">{sendsLine}</p>
          <div className="fhi-draft__actions">
            <Button
              variant="primary"
              size="md"
              className="fhi-draft__send"
              aria-label="Send draft reply"
              loading={sending}
              disabled={empty || discarding || !ready}
              onClick={onSend}
            >
              Send
            </Button>
            <Button variant="quiet" size="md" disabled={sending || discarding} onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

export default function Thread({ conversationId, row: listRow, embedded = false }: ThreadProps) {
  const { orgId, conversation, outside, messages, runs, runsFresh, isLoading, isError, refetch } = useThread(conversationId)
  const actions = useInboxActions(conversationId, orgId)
  const { markRead } = actions
  const jobs = useJobs()

  // The phone thread brings its own header and composer, so the dock steps aside.
  useHideDock(!embedded)

  // The list row when the list has it; otherwise the conversation's own
  // row, but only when it is in the active company.
  const row = listRow ?? (conversation && !outside ? conversation : undefined)
  // Confirmed in the active company: the list (which only holds this
  // company's conversations) has it, or its own row says so.
  const inCompany = !outside && (!!listRow || (!!conversation && conversation.org_id === orgId))

  const shownRow = row ?? conversation ?? undefined
  const name = shownRow?.client_name?.trim() || shownRow?.company_name?.trim() || 'Conversation'
  const job = useMemo(() => (outside ? null : jobFor(row, jobs.data)), [outside, row, jobs.data])
  const stage = outside ? null : stageChip(row?.latest_stage)

  const days = useMemo(() => groupByDay(threadItems(messages, runs)), [messages, runs])
  const itemCount = days.reduce((n, d) => n + d.items.length, 0)

  // ---- Mark read, once per opening, and only inside the active company.
  // A ref, because the screen renders many times and React runs effects
  // twice in development.
  const markedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!inCompany || markedFor.current === conversationId) return
    markedFor.current = conversationId
    void markRead(conversationId)
  }, [conversationId, inCompany, markRead])

  // ---- Start at the newest message, and follow new ones.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (embedded && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(id)
  }, [conversationId, itemCount, embedded])

  // ---- Focus goes back to the reply field after a send, an approval or a
  // discard, or to the heading when the field cannot take it.
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusReply = useCallback(() => {
    const field = fieldRef.current
    if (field && !field.disabled) field.focus()
    else headingRef.current?.focus()
  }, [])

  // ---- How a reply goes out.
  const reach = replyChannel({ last_channel: row?.last_channel, phone: row?.phone, email: row?.email })
  const [channelChoice, setChannelChoice] = useState<ReplyChannel | null>(null)
  const channel = channelChoice && reach.options.includes(channelChoice) ? channelChoice : reach.channel
  const clientId = row?.client_id ?? messages[0]?.client_id ?? null
  const subject = replySubject(messages)
  const canWrite = !outside && channel !== null && clientId !== null

  // ---- The draft: the person's edits live here, keyed by the agent run.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [openOlder, setOpenOlder] = useState<Record<string, boolean>>({})
  const draftValue = (item: ThreadDraftItem) => edits[item.id] ?? item.body
  const draftWay = (item: ThreadDraftItem) => {
    const way = draftChannel(item.channel) ?? reach.channel
    return draftSendsLine({ channel: way, subject: item.subject ?? (way === 'email' ? subject : null), name })
  }

  const sendDraft = async (item: ThreadDraftItem) => {
    const body = draftValue(item).trim()
    if (!body || !runsFresh || outside) return
    hapticTap()
    const result = await actions.approveDraft(item.runId, body)
    if (result.ok) focusReply()
    else if (result.reason === 'offline') toastError(NO_SIGNAL)
    else if (result.reason === 'failed') toastError(NOT_CONFIRMED, CHECK_THREAD)
  }

  const discardDraft = async (item: ThreadDraftItem) => {
    if (outside) return
    hapticTap()
    const result = await actions.rejectDraft(item.runId)
    if (result.ok) {
      toastInfo('Draft discarded')
      focusReply()
    } else if (result.reason === 'offline') toastError('No signal. Nothing was discarded.')
    else if (result.reason === 'failed') toastError("Couldn't discard that draft", 'Check your connection and try again.')
  }

  // ---- The composer.
  const [text, setText] = useState('')
  const sending = actions.sending

  // ---- Dictation: the browser's SpeechRecognition, as CaptureSheet uses it.
  // It only fills the text; the person reads it and taps Send. Every
  // handler checks it still belongs to the current recognizer, so a result
  // from one that was stopped, aborted or replaced is ignored.
  const recRef = useRef<Recognition | null>(null)
  const [listening, setListening] = useState(false)

  /** Ends dictation now: the handlers come off before abort, so nothing heard later lands. */
  const endVoice = useCallback(() => {
    const rec = recRef.current
    recRef.current = null
    setListening(false)
    if (!rec) return
    rec.onresult = null
    rec.onend = null
    rec.onerror = null
    try { rec.abort() } catch { /* already stopped */ }
  }, [])

  /** The person taps the mic again: stop listening, and keep the last words it heard. */
  const stopVoice = () => {
    setListening(false)
    try { recRef.current?.stop() } catch { /* already stopped */ }
  }

  const startVoice = () => {
    const Ctor = speechCtor()
    if (!Ctor) {
      toastInfo('Voice not supported here', 'Type it instead.')
      return
    }
    hapticTap()
    endVoice()
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    const base = text.trim() ? `${text.trimEnd()} ` : ''
    let final = ''
    rec.onresult = (event) => {
      if (recRef.current !== rec) return
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript
        if (event.results[i].isFinal) final += part
        else interim += part
      }
      setText(`${base}${final}${interim}`.replace(/\s+/g, ' ').trimStart())
    }
    rec.onend = () => {
      if (recRef.current !== rec) return
      recRef.current = null
      setListening(false)
    }
    rec.onerror = (event) => {
      if (recRef.current !== rec) return
      recRef.current = null
      setListening(false)
      const feedback = speechErrorFeedback(event?.error)
      if (feedback) (feedback.tone === 'info' ? toastInfo : toastError)(feedback.title, feedback.description)
    }
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  // Leaving the thread ends any dictation in progress. The phone and the
  // desktop both key the thread by conversation, so opening another one
  // is a fresh screen.
  useEffect(() => endVoice, [endVoice])

  useAutosize(fieldRef, text, 5)

  const sendTyped = async () => {
    const body = text.trim()
    if (!body || !canWrite || !channel || !clientId || sending) return
    hapticTap()
    // Before anything is awaited: the mic is done with this text.
    endVoice()
    const result = await actions.sendMessage({
      body,
      channel,
      clientId,
      ...(channel === 'email' && subject ? { subject } : {})
    })
    if (result.ok) {
      setText('')
      focusReply()
    } else if (result.reason === 'offline') toastError(NO_SIGNAL)
    else if (result.reason === 'failed') toastError(NOT_CONFIRMED, CHECK_THREAD)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void sendTyped()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void sendTyped()
    }
  }

  // ---- Render
  const Heading = embedded ? 'h2' : 'h1'
  const phone = outside ? '' : row?.phone?.trim().replace(/\s+/g, '') || ''

  return (
    <div className={`fhi-thread${embedded ? ' is-embedded' : ''}`}>
      <header className="fhi-thread__head">
        {!embedded && (
          <IconButton to="/inbox" aria-label="Back to inbox" icon={ChevronLeft} variant="plain" size={44} />
        )}
        <div className="fhi-thread__who">
          <Heading className="fhi-thread__name" ref={headingRef} tabIndex={-1}>{name}</Heading>
          {job ? (
            <Link className="fhi-jobchip" to={`/jobs/${job.id}`}>
              <Icon icon={HardHat} size={18} />
              <span>{job.job_title?.trim() || job.name || 'Open job'}</span>
            </Link>
          ) : stage ? (
            <Chip label={stage.label} tone={stage.tone} />
          ) : null}
        </div>
        {phone && (
          <IconButton to={`tel:${phone}`} aria-label={`Call ${name}`} icon={Phone} variant="plain" size={44} />
        )}
      </header>

      <div className="fhi-thread__scroll" ref={scrollRef}>
        {outside ? (
          <div className="fhi-flow">
            <EmptyState
              icon={Building2}
              title="Not in this company"
              action={<p className="fhi-off__note">Switch to its company in the workspace menu to read it.</p>}
            />
          </div>
        ) : isLoading ? (
          <div className="fhi-flow" role="status" aria-busy="true" aria-live="polite">
            <span className="fhc-vh">Loading messages</span>
            <Skeleton shape="block" width="62%" height={72} className="fhi-skel fhi-skel--out" />
            <Skeleton shape="block" width="48%" height={44} className="fhi-skel" />
            <Skeleton shape="block" width="70%" height={72} className="fhi-skel" />
          </div>
        ) : isError && itemCount === 0 ? (
          <div className="fhi-flow">
            <DataErrorState title="Could not load this conversation" message="Check your connection and try again." onRetry={refetch} />
          </div>
        ) : itemCount === 0 ? (
          <div className="fhi-flow">
            <p className="fhi-quiet">No messages in this conversation yet.</p>
          </div>
        ) : (
          <div className="fhi-flow" role="log" aria-label="Messages" aria-relevant="additions">
            {days.map((day) => (
              <div className="fhi-day" key={day.key}>
                <p className="fhi-day__label">{day.label}</p>
                {day.items.map((item) =>
                  item.kind === 'message' ? (
                    <Bubble key={item.id} item={item} name={name} />
                  ) : (
                    <DraftPanel
                      key={item.id}
                      item={item}
                      name={name}
                      text={draftValue(item)}
                      sendsLine={draftWay(item)}
                      onChange={(value) => setEdits((prev) => ({ ...prev, [item.id]: value }))}
                      onSend={() => void sendDraft(item)}
                      onDiscard={() => void discardDraft(item)}
                      sending={actions.approving}
                      discarding={actions.rejecting}
                      ready={runsFresh}
                      open={openOlder[item.id] === true}
                      onToggle={() => setOpenOlder((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!outside && (
        <form className="fhi-composer" onSubmit={onSubmit} aria-label="Write a reply">
          {reach.options.length > 1 && channel ? (
            <p className="fhi-composer__channel">
              <span>{channel === 'sms' ? 'Replying by text' : 'Replying by email'}</span>
              <button
                type="button"
                className="fhi-composer__switch"
                onClick={() => setChannelChoice(channel === 'sms' ? 'email' : 'sms')}
              >
                {channel === 'sms' ? 'Use email' : 'Use text'}
              </button>
            </p>
          ) : channel ? (
            <p className="fhi-composer__channel">{channel === 'sms' ? 'Replying by text' : 'Replying by email'}</p>
          ) : row ? (
            <p className="fhi-composer__channel">No phone number or email on file for this customer.</p>
          ) : null}
          <div className="fhi-composer__row">
            <div className="fhi-composer__field">
              <textarea
                ref={fieldRef}
                className="fhi-composer__input"
                aria-label="Write a reply"
                placeholder="Write a reply"
                rows={1}
                value={text}
                disabled={!canWrite}
                readOnly={sending}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button
                type="button"
                className={`fhi-composer__mic${listening ? ' is-listening' : ''}`}
                aria-label="Dictate a reply"
                aria-pressed={listening}
                disabled={!canWrite || sending}
                onClick={() => (listening ? stopVoice() : startVoice())}
              >
                <Icon icon={Mic} size={22} />
              </button>
            </div>
            <IconButton
              type="submit"
              className="fhi-send"
              aria-label="Send reply"
              icon={SendHorizontal}
              variant="onyx"
              shape="square"
              size={48}
              disabled={!canWrite || sending || text.trim() === ''}
            />
          </div>
        </form>
      )}
    </div>
  )
}
