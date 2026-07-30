// src/screens/Activity.jsx
//
// Global activity feed, every event across every job, in one
// chronological stream. Pulls the last 50-ish rows from each
// per-job table (fh_stage_transitions, fh_payments, fh_change_orders,
// fh_invoices) plus the contact metadata that anchors them, then
// renders a date-grouped feed (Today / Yesterday / This week / etc).
//
// Each event links to the source job. The contractor can scan the
// stream as a "what happened today across all my work" surface,
// then tap to drill into the job that triggered the event.
//
// No new schema. Uses indexes already in place (everything is
// scoped by user_id via RLS).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity as ActivityIcon, DollarSign, FileEdit, Check, Calendar,
  Briefcase, Sparkles, Receipt, ArrowRight
} from 'lucide-react'
import { useActivityFeed } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useFhMotion } from '../lib/motion.ts'
import { SkeletonList } from '../components/Skeleton.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { Eyebrow } from '../components/v3'

const PAGE_SIZE = 60

function money(n: any) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  })
}

function capitalize(s: any) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '' }

const STAGE_TONE: Record<string, any> = {
  closed: 'green',
  lost:   'red',
  invoice:'gold',
  job:    'gold',
  quote:  'gold',
  lead:   'neutral'
}

// Group events by relative date bucket so the feed reads as a
// timeline of "today / yesterday / this week / older" sections.
function bucketLabel(d: any) {
  if (!d) return 'Earlier'
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  if (ts === today) return 'Today'
  if (ts === today - dayMs) return 'Yesterday'
  if (ts > today - 7 * dayMs) return 'This week'
  if (ts > today - 30 * dayMs) return 'This month'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function timeAt(d: any) {
  if (!d) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function Activity() {
  const { user } = useAuth()
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const { data: bundle, isError, refetch, isFetching } = useActivityFeed(user?.id, pageSize)
  const { stagger, item } = useFhMotion()

  // Map the raw datasets into display events. Kept in the component
  // (not the query cache) because the mapping references icon
  // components. events === null until the first fetch resolves so the
  // loading state below still works.
  const events = useMemo(() => {
    if (!bundle) return null
    const { transitions, payments, changeOrders, invoices, contacts } = bundle
    const contactById = new Map((contacts || []).map((c) => [c.id, c]))

    const out = []

    for (const t of transitions || []) {
        out.push({
          id: `st:${t.id}`,
          when: new Date(t.transitioned_at),
          contact: contactById.get(t.contact_id),
          contactId: t.contact_id,
          kind: 'stage',
          icon: t.to_stage === 'closed' ? Check : t.to_stage === 'invoice' ? Receipt : Briefcase,
          tone: STAGE_TONE[t.to_stage] || 'gold',
          // Stage labels that read as sentences: "New Closed" is not a
          // thing anyone says. "Deal closed" / "Deal lost" / "New lead".
          title: t.from_stage
            ? `${capitalize(t.from_stage)} → ${capitalize(t.to_stage)}`
            : t.to_stage === 'closed'
              ? 'Deal closed'
              : t.to_stage === 'lost'
                ? 'Deal lost'
                : `New ${capitalize(t.to_stage)}`
        })
      }

      for (const p of payments || []) {
        const kindStr = p.kind && p.kind !== 'other' ? ` · ${p.kind}` : ''
        out.push({
          id: `p:${p.id}`,
          when: new Date((p.paid_on || p.created_at) as any),
          contact: contactById.get(p.contact_id as string),
          contactId: p.contact_id,
          kind: 'payment',
          icon: DollarSign,
          tone: 'green',
          title: `${money(p.amount)} received${kindStr}`,
          sub: p.method ? capitalize(p.method) : null
        })
      }

      for (const co of changeOrders || []) {
        const isApproved = co.status === 'approved'
        const ts = isApproved && co.approved_at ? co.approved_at : co.created_at
        out.push({
          id: `co:${co.id}`,
          when: new Date(ts),
          contact: contactById.get(co.contact_id),
          contactId: co.contact_id,
          kind: isApproved ? 'co_approved' : 'co_added',
          icon: isApproved ? Check : FileEdit,
          tone: isApproved ? 'green' : 'neutral',
          title: isApproved
            ? `CO #${co.sequence_number} approved, ${co.title || ''}`
            : `CO #${co.sequence_number} added, ${co.title || ''}`,
          sub: `${co.amount >= 0 ? '+' : ''}${money(co.amount)}`
        })
      }

      for (const inv of invoices || []) {
        if (inv.status === 'void') continue
        out.push({
          id: `inv:${inv.id}`,
          when: new Date(inv.issued_at || inv.created_at),
          contact: contactById.get(inv.contact_id),
          contactId: inv.contact_id,
          kind: 'invoice',
          icon: Receipt,
          tone: inv.status === 'paid' ? 'green' : 'gold',
          title: `Draw #${inv.sequence_number} ${inv.status === 'paid' ? 'paid' : inv.status}${inv.title ? `, ${inv.title}` : ''}`,
          sub: money(inv.amount)
        })
      }

    return out
      .filter((e) => e.when instanceof Date && !Number.isNaN(e.when.getTime()))
      .sort((a: any, b: any) => b.when.getTime() - a.when.getTime())
  }, [bundle])

  // Group by date bucket for the section headers.
  const grouped = useMemo(() => {
    if (!events) return null
    const buckets = new Map()
    for (const e of events) {
      const label = bucketLabel(e.when)
      if (!buckets.has(label)) buckets.set(label, [])
      buckets.get(label).push(e)
    }
    return Array.from(buckets.entries())
  }, [events])

  const loading = events === null
  const empty = !loading && events.length === 0

  // Without this, a failed fetch leaves events===null forever → an infinite
  // skeleton that looks like a hang. Show an honest error + retry instead.
  if (isError) {
    return (
      <div className="v3-screen" style={{ padding: '24px 24px' }}>
        <DataErrorState
          title="Couldn't load activity"
          message="We couldn't reach your activity feed. Check your connection and retry."
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <motion.div
      className="v3-screen fh-readable-desktop"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{
        paddingBottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--v3-bg)'
      }}
    >
      <motion.div variants={item} style={{ padding: '12px 24px 8px' }}>
        <Eyebrow as="div" tone="gold">
          <ActivityIcon size={11} aria-hidden="true" />
          Recent
        </Eyebrow>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          letterSpacing: 0,
          color: 'var(--v3-text)',
          margin: '6px 0 4px',
          lineHeight: 1.05
        }}>
          Activity
        </h1>
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--v3-text-muted)',
          margin: 0,
          lineHeight: 1.45
        }}>
          Every payment, draw, stage change, and change order, across every job.
        </p>
      </motion.div>

      <motion.div variants={item} style={{ padding: '12px 24px 24px' }}>
        {loading && <SkeletonList rows={6} card={false} />}
        {empty && (
          <div style={{
            padding: '32px 24px', borderRadius: 10,
            background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
            color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
            fontSize: 14, textAlign: 'center', lineHeight: 1.5,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
          }}>
            <Sparkles size={26} aria-hidden="true" color="var(--v3-text-muted)" />
            <div>Nothing has happened yet. Create a lead, log a payment, or send a proposal to see the timeline fill in.</div>
          </div>
        )}
        {grouped && grouped.map(([label, items]) => (
          <section key={label} style={{ marginBottom: 22 }}>
            <Eyebrow as="div" style={{ marginBottom: 10 }}>
              {label}
              <span style={{ marginLeft: 8, color: 'var(--v3-text-faint, var(--v3-text-muted))' }}>
                · {items.length}
              </span>
            </Eyebrow>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((e: any) => <EventRow key={e.id} event={e} />)}
            </ul>
          </section>
        ))}

        {/* Load older, show only when a source actually filled its page
            (bundle.hasMore), not when the merged feed happens to exceed
            pageSize (4 sources can sum past it while all are exhausted). */}
        {!loading && !empty && bundle?.hasMore && pageSize < 480 && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
            <button
              type="button"
              onClick={() => setPageSize((p) => Math.min(p + 60, 480))}
              disabled={isFetching}
              style={{
                minHeight: 44, padding: '12px 24px', borderRadius: 10,
                background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
                fontSize: 14, fontWeight: 600, cursor: isFetching ? 'wait' : 'pointer',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {isFetching ? 'Loading…' : 'Load older activity'}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function EventRow({ event }: any) {
  const Icon = event.icon || ActivityIcon
  const tone = ({
    neutral: { fg: 'var(--v3-text-muted)', bg: 'var(--v3-glass-tint-2)', br: 'var(--v3-border-mid)' },
    gold:    { fg: 'var(--v3-primary-bright)', bg: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)', br: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)' },
    green:   { fg: 'var(--v3-success-bright, #2D7A4F)', bg: 'rgba(45, 122, 79,0.10)', br: 'rgba(45, 122, 79,0.30)' },
    red:     { fg: 'var(--v3-danger-bright, #C9963A)', bg: 'rgba(192, 57, 43,0.10)', br: 'rgba(192, 57, 43,0.30)' }
  } as Record<string, any>)[event.tone || 'neutral']

  const jobName = event.contact?.name || event.contact?.job_title || 'Unknown job'

  return (
    <li>
      <Link
        to={`/jobs/${event.contactId}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '36px 1fr auto',
          gap: 12,
          padding: '12px 12px',
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          borderRadius: 10,
          textDecoration: 'none',
          color: 'inherit',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: tone.bg, border: `1px solid ${tone.br}`,
            color: tone.fg,
            display: 'grid', placeItems: 'center',
            flexShrink: 0
          }}
        >
          <Icon size={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
            color: 'var(--v3-text)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {event.title}
          </div>
          <div style={{
            marginTop: 3,
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'var(--v3-text-muted)', lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            <span style={{ color: 'var(--v3-text-secondary)', fontWeight: 600 }}>
              {jobName}
            </span>
            {event.sub && <> · {event.sub}</>}
            {' · '}
            {timeAt(event.when)}
          </div>
        </div>
        <ArrowRight size={14} color="var(--v3-text-faint, var(--v3-text-muted))" style={{ alignSelf: 'center', flexShrink: 0 }} />
      </Link>
    </li>
  )
}
