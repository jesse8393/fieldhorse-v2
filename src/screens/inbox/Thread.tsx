// One conversation (spec 9.8, render base/inbox.jpg): a header with the
// customer's name, a chip for their job and a call button; the messages as
// bubbles under Yesterday and Today style labels, sent ones in ink with
// linen text on the right and received ones on paper on the left; an AI
// draft panel when an agent has proposed a reply; and a composer with
// dictation and a dark send button.
//
// Trust rules. Nothing leaves without a tap:
//   * Opening a thread only reads it, and marks it read once.
//   * The draft panel is draft mode only: "Draft reply" in a text area the
//     person can edit, a brushed gold "Send" that approves it with the text
//     as it stands (fh_agent_run_approve, p_body), and a quiet "Discard".
//     Send is the one gold action on the screen.
//   * The composer sends through fh_send_message only from its own button.
//   * A held message never looks sent. It is drawn as an outline with the
//     reason in words ("Held: outside sending hours"), and no send time.
//   * Dictation only fills the text. The person reads it and taps Send.
//     No audio is recorded: it is the browser's SpeechRecognition, used the
//     way CaptureSheet uses it.
//
// Left out on purpose: the optional "also move the visit" checkbox the
// spec mentions. The phase plan does not build it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Clock, HardHat, Mic, Phone, SendHorizontal, Sparkles } from 'lucide-react'
import { Button, Chip, Icon, IconButton, Skeleton } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useJobs, type JobRow } from '../../lib/queries.ts'
import { useHideDock } from '../../lib/dockVisibility.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { speechErrorFeedback } from '../../lib/speech.ts'
import { toastError, toastInfo } from '../../lib/toast.ts'
import {
  groupByDay,
  replyChannel,
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

/** The job to link from the header: the customer's job at the stage the list shows, else the newest. */
function jobFor(row: InboxRow | undefined, jobs: JobRow[] | undefined): JobRow | null {
  if (!row?.client_id || !jobs) return null
  const mine = jobs.filter((j) => j.client_id === row.client_id)
  if (mine.length === 0) return null
  const sameStage = mine.filter((j) => j.stage === row.latest_stage)
  const pool = sameStage.length > 0 ? sameStage : mine
  return [...pool].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0]
}

/** Grows a text area to fit what is in it. */
function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxRows = 6) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 24)}px`
  }, [ref, value, maxRows])
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

function Bubble({ item }: { item: ThreadMessageItem }) {
  const channelWord = CHANNEL_WORDS[item.channel] ?? null
  const when = timeLabel(item.at)
  return (
    <div className={`fhi-msg ${item.outgoing ? 'is-out' : 'is-in'} is-${item.state}`}>
      <div className="fhi-bubble">
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
      ) : item.state === 'sending' ? (
        <p className="fhi-meta">Not sent yet</p>
      ) : (
        <p className="fhi-meta">{channelWord ? `${when}, ${channelWord}` : when}</p>
      )}
    </div>
  )
}

type DraftPanelProps = {
  item: ThreadDraftItem
  text: string
  onChange: (text: string) => void
  onSend: () => void
  onDiscard: () => void
  sending: boolean
  discarding: boolean
}

/** The agent's proposed reply. Draft mode only: editable, and nothing goes without Send. */
function DraftPanel({ item, text, onChange, onSend, onDiscard, sending, discarding }: DraftPanelProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(areaRef, text, 10)
  const labelId = `fhi-draft-label-${item.id}`
  const empty = text.trim() === ''
  return (
    <section className="fhi-draft" aria-labelledby={labelId}>
      <div className="fhi-draft__head">
        <Icon icon={Sparkles} size={18} />
        <p className="fhi-draft__label" id={labelId}>Draft reply</p>
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
      </div>
      <textarea
        ref={areaRef}
        className="fhi-draft__text"
        aria-labelledby={labelId}
        rows={3}
        value={text}
        readOnly={sending}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="fhi-draft__actions">
        <Button
          variant="primary"
          size="md"
          className="fhi-draft__send"
          loading={sending}
          disabled={empty || discarding}
          onClick={onSend}
        >
          Send
        </Button>
        <Button variant="quiet" size="md" disabled={sending || discarding} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

export default function Thread({ conversationId, row, embedded = false }: ThreadProps) {
  const { messages, runs, isLoading, isError, refetch } = useThread(conversationId)
  const actions = useInboxActions(conversationId)
  const { markRead } = actions
  const jobs = useJobs()

  // The phone thread brings its own header and composer, so the dock steps aside.
  useHideDock(!embedded)

  const name = row?.client_name?.trim() || row?.company_name?.trim() || 'Conversation'
  const job = useMemo(() => jobFor(row, jobs.data), [row, jobs.data])
  const stage = stageChip(row?.latest_stage)

  const days = useMemo(() => groupByDay(threadItems(messages, runs)), [messages, runs])
  const itemCount = days.reduce((n, d) => n + d.items.length, 0)

  // ---- Mark read, once per opening. A ref, because the screen renders
  // many times and React runs effects twice in development.
  const markedFor = useRef<string | null>(null)
  useEffect(() => {
    if (markedFor.current === conversationId) return
    markedFor.current = conversationId
    void markRead(conversationId)
  }, [conversationId, markRead])

  // ---- Start at the newest message, and follow new ones.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (embedded && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(id)
  }, [conversationId, itemCount, embedded])

  // ---- The draft: the person's edits live here, keyed by the agent run.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const draftValue = (item: ThreadDraftItem) => edits[item.id] ?? item.body

  const sendDraft = async (item: ThreadDraftItem) => {
    const body = draftValue(item).trim()
    if (!body) return
    hapticTap()
    const result = await actions.approveDraft(item.runId, body)
    if (!result.ok && !result.skipped) {
      toastError("That reply didn't go out", 'Your changes are still here. Check the thread, then try again.')
    }
  }

  const discardDraft = async (item: ThreadDraftItem) => {
    hapticTap()
    const result = await actions.rejectDraft(item.runId)
    if (result.ok) toastInfo('Draft discarded')
    else if (!result.skipped) toastError("Couldn't discard that draft", 'Check your connection and try again.')
  }

  // ---- The composer.
  const [text, setText] = useState('')
  // ---- Dictation: the browser's SpeechRecognition, as CaptureSheet uses it.
  // It only fills the text; the person reads it and taps Send.
  const recRef = useRef<Recognition | null>(null)
  const [listening, setListening] = useState(false)

  const stopVoice = useCallback(() => {
    try { recRef.current?.stop() } catch { /* already stopped */ }
    recRef.current = null
    setListening(false)
  }, [])

  const startVoice = () => {
    const Ctor = speechCtor()
    if (!Ctor) {
      toastInfo('Voice not supported here', 'Type it instead.')
      return
    }
    hapticTap()
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    const base = text.trim() ? `${text.trimEnd()} ` : ''
    let final = ''
    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0].transcript
        if (event.results[i].isFinal) final += part
        else interim += part
      }
      setText(`${base}${final}${interim}`.replace(/\s+/g, ' ').trimStart())
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
    }
    rec.onerror = (event) => {
      recRef.current = null
      setListening(false)
      const feedback = speechErrorFeedback(event?.error)
      if (feedback) (feedback.tone === 'info' ? toastInfo : toastError)(feedback.title, feedback.description)
    }
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  // Leaving the thread, or opening another, ends any dictation in progress.
  useEffect(() => () => {
    try { recRef.current?.abort() } catch { /* nothing running */ }
    recRef.current = null
  }, [conversationId])

  const [channelChoice, setChannelChoice] = useState<ReplyChannel | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useAutosize(fieldRef, text, 5)

  const reach = replyChannel({ last_channel: row?.last_channel, phone: row?.phone, email: row?.email })
  const channel = channelChoice && reach.options.includes(channelChoice) ? channelChoice : reach.channel
  const clientId = row?.client_id ?? messages[0]?.client_id ?? null
  const lastSubject = [...messages].reverse().find((m) => m.subject)?.subject ?? null
  const canWrite = channel !== null && clientId !== null

  const sendTyped = async () => {
    const body = text.trim()
    if (!body || !channel || !clientId) return
    hapticTap()
    stopVoice()
    const result = await actions.sendMessage({
      body,
      channel,
      clientId,
      ...(channel === 'email' && lastSubject ? { subject: /^re:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}` } : {})
    })
    if (result.ok) setText('')
    else if (!result.skipped) toastError("That message didn't go out", 'Your words are still here. Check the thread, then try again.')
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
  const phone = row?.phone?.trim().replace(/\s+/g, '') || ''
  const sending = actions.sending

  return (
    <div className={`fhi-thread${embedded ? ' is-embedded' : ''}`}>
      <header className="fhi-thread__head">
        {!embedded && (
          <IconButton to="/inbox" aria-label="Back to inbox" icon={ChevronLeft} variant="plain" size={44} />
        )}
        <div className="fhi-thread__who">
          <Heading className="fhi-thread__name">{name}</Heading>
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
        {isLoading ? (
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
                    <Bubble key={item.id} item={item} />
                  ) : (
                    <DraftPanel
                      key={item.id}
                      item={item}
                      text={draftValue(item)}
                      onChange={(value) => setEdits((prev) => ({ ...prev, [item.id]: value }))}
                      onSend={() => void sendDraft(item)}
                      onDiscard={() => void discardDraft(item)}
                      sending={actions.approving}
                      discarding={actions.rejecting}
                    />
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className={`fhi-composer__mic${listening ? ' is-listening' : ''}`}
              aria-label={listening ? 'Stop dictating' : 'Dictate a reply'}
              aria-pressed={listening}
              disabled={!canWrite}
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
    </div>
  )
}
