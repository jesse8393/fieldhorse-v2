// The Inbox (spec 9.8, decision D9). On a phone it is a hairline list of
// conversations: name, a two line preview, the time, a dot for unread, a
// chip for the job's stage, a "Draft ready" chip when an agent wrote a
// reply for the person to approve and a "Held" chip when a reply is held
// back. A tap opens the thread full screen. At 900 px and wider the list
// sits on the left and the open thread on the right, from the same
// components.
//
// The Inbox only exists when the company's messaging engine is on
// (fh_org_settings.engine_enabled). While it is off the screen says
// "Inbox turns on with messaging" and points to Settings; while the
// setting is still loading it shows a skeleton, never the message.
//
// There is no gold action here. The one brushed gold button lives in the
// thread, on the agent's draft.

import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Inbox as InboxIcon, MessageSquare } from 'lucide-react'
import { Button, Chip, EmptyState, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { useIsDesktop } from '../../lib/useMediaQuery.ts'
import { hapticTap } from '../../lib/haptics.ts'
import {
  listTimeLabel,
  stageChip,
  useEngineEnabled,
  useInbox,
  type InboxRow
} from '../../lib/inbox.ts'
import Thread from './Thread.tsx'
import './inbox.css'

function nameOf(row: InboxRow): string {
  return row.client_name?.trim() || row.company_name?.trim() || 'Unknown sender'
}

type ListProps = {
  rows: InboxRow[]
  loading: boolean
  error: boolean
  onRetry: () => void
  /** The conversation open beside the list on a desktop. */
  selectedId?: string
}

function InboxList({ rows, loading, error, onRetry, selectedId }: ListProps) {
  const now = new Date()
  return (
    <div className="fhi-body">
      {loading ? (
        <SkeletonRows rows={6} label="Loading conversations" />
      ) : error && rows.length === 0 ? (
        <DataErrorState
          title="Could not load your messages"
          message="Check your connection and try again."
          onRetry={onRetry}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={InboxIcon} title="No conversations yet." />
      ) : (
        <ul className="fhi-rows">
          {rows.map((row) => {
            const id = row.conversation_id ?? ''
            const unread = (row.unread_count ?? 0) > 0
            const drafts = (row.pending_drafts ?? 0) > 0
            const held = (row.held_messages ?? 0) > 0
            const stage = stageChip(row.latest_stage)
            const selected = id !== '' && id === selectedId
            return (
              <Row
                key={id || nameOf(row)}
                as="li"
                to={`/inbox/${id}`}
                onClick={() => hapticTap()}
                dot={unread ? 'info' : undefined}
                className={`fhi-row${unread ? ' is-unread' : ''}${selected ? ' is-selected' : ''}`}
                title={
                  <>
                    {unread && <span className="fhc-vh">Unread. </span>}
                    {nameOf(row)}
                    {selected && <span className="fhc-vh">. Open now</span>}
                  </>
                }
                subline={row.last_preview?.trim() || 'No messages yet'}
                next={
                  <span className="fhi-end">
                    <span className="fhi-time">{listTimeLabel(row.last_message_at, now)}</span>
                    {(stage || drafts || held) && (
                      <span className="fhi-chips">
                        {drafts && <Chip label="Draft ready" tone="info" />}
                        {held && <Chip label="Held" tone="neutral" />}
                        {stage && <Chip label={stage.label} tone={stage.tone} />}
                      </span>
                    )}
                  </span>
                }
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

function EngineOff() {
  const { canEditSettings } = useMembership()
  return (
    <div className="fhi-off">
      <EmptyState
        icon={MessageSquare}
        title="Inbox turns on with messaging"
        action={
          canEditSettings ? (
            <Button variant="secondary" size="md" to="/settings">Open Settings</Button>
          ) : (
            <p className="fhi-off__note">Ask an owner or an admin to turn it on.</p>
          )
        }
      />
    </div>
  )
}

export default function Inbox() {
  const { conversationId } = useParams()
  const isDesktop = useIsDesktop()
  const engine = useEngineEnabled()
  const inbox = useInbox({ enabled: engine === true })

  // The heading takes focus when the list opens, so a screen reader
  // starts at the top of the page. A thread has its own heading.
  const titleRef = useRef<HTMLHeadingElement>(null)
  const listOnly = !conversationId
  useEffect(() => {
    if (listOnly) titleRef.current?.focus({ preventScroll: true })
  }, [listOnly])

  const rows = inbox.data ?? []
  const loading = engine === undefined || (engine === true && inbox.isLoading)

  const title = <h1 className="fhi-title" ref={titleRef} tabIndex={-1}>Inbox</h1>

  if (engine === false) {
    return (
      <div className="fhi">
        <header className="fhi-head">{title}</header>
        <EngineOff />
      </div>
    )
  }

  const openRow = conversationId ? rows.find((r) => r.conversation_id === conversationId) : undefined

  // A phone shows one thing at a time: the thread when one is open.
  if (!isDesktop && conversationId && engine === true) {
    return <Thread conversationId={conversationId} row={openRow} />
  }

  const list = (
    <InboxList
      rows={rows}
      loading={loading}
      error={inbox.isError}
      onRetry={() => void inbox.refetch()}
      selectedId={isDesktop ? conversationId : undefined}
    />
  )

  if (isDesktop) {
    return (
      <div className="fhi fhi--split">
        <aside className="fhi-split__list" aria-label="Conversations">
          <header className="fhi-head">{title}</header>
          {list}
        </aside>
        <section className="fhi-split__detail" aria-label="Conversation">
          {conversationId && engine === true ? (
            <Thread key={conversationId} conversationId={conversationId} row={openRow} embedded />
          ) : (
            <div className="fhi-split__empty">
              <EmptyState icon={MessageSquare} title="Choose a conversation to read it." />
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="fhi">
      <header className="fhi-head">{title}</header>
      {list}
    </div>
  )
}
