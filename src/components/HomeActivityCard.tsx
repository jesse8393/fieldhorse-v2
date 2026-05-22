// src/components/HomeActivityCard.tsx
//
// Compact "recent activity" card for Home. Brings the cross-job feed
// from /activity onto the dashboard surface — top 5 events + a
// "See all →" link to the full screen.
//
// Reuses the same query shape as Activity.jsx (4 parallel fetches +
// contact roster join) but caps each source at 8 rows so the top
// 5 cross-source result resolves cheaply. Auto-hides on a brand-new
// account with no events.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity as ActivityIcon, DollarSign, FileEdit, Check, Briefcase, Receipt, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../contexts/AuthContext.tsx'

const PER_SOURCE = 8

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
  invoice: 'gold',
  job:    'gold',
  quote:  'gold',
  lead:   'neutral'
}

function relTime(d: any) {
  if (!d) return ''
  const now = new Date()
  const diffMs = now.getTime() - new Date(d).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function HomeActivityCard() {
  const { user } = useAuth()
  const [events, setEvents] = useState<any>(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      const [
        { data: transitions },
        { data: payments },
        { data: changeOrders },
        { data: invoices },
        { data: contacts }
      ] = await Promise.all([
        supabase.from('fh_stage_transitions')
          .select('id, contact_id, from_stage, to_stage, transitioned_at')
          .eq('user_id', user.id)
          .order('transitioned_at', { ascending: false })
          .limit(PER_SOURCE),
        supabase.from('fh_payments')
          .select('id, contact_id, amount, kind, paid_on, created_at')
          .eq('user_id', user.id)
          .order('paid_on', { ascending: false })
          .limit(PER_SOURCE),
        supabase.from('fh_change_orders')
          .select('id, contact_id, sequence_number, title, amount, status, approved_at, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(PER_SOURCE),
        supabase.from('fh_invoices')
          .select('id, contact_id, sequence_number, title, amount, status, issued_at, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(PER_SOURCE),
        supabase.from('fh_contacts')
          .select('id, name, job_title')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(PER_SOURCE * 2)
      ])
      if (cancelled) return
      const byId = new Map((contacts || []).map((c) => [c.id, c]))
      const out = []

      for (const t of transitions || []) {
        out.push({
          id: `st:${t.id}`,
          when: new Date(t.transitioned_at),
          contactId: t.contact_id,
          contact: byId.get(t.contact_id),
          icon: t.to_stage === 'closed' ? Check : t.to_stage === 'invoice' ? Receipt : Briefcase,
          tone: STAGE_TONE[t.to_stage] || 'gold',
          title: t.from_stage ? `${capitalize(t.from_stage)} → ${capitalize(t.to_stage)}` : `New ${capitalize(t.to_stage)}`
        })
      }
      for (const p of payments || []) {
        const kindStr = p.kind && p.kind !== 'other' ? ` · ${p.kind}` : ''
        out.push({
          id: `p:${p.id}`,
          when: new Date((p.paid_on || p.created_at) as any),
          contactId: p.contact_id,
          contact: byId.get(p.contact_id as string),
          icon: DollarSign,
          tone: 'green',
          title: `${money(p.amount)} received${kindStr}`
        })
      }
      for (const co of changeOrders || []) {
        const isApproved = co.status === 'approved'
        const ts = isApproved && co.approved_at ? co.approved_at : co.created_at
        out.push({
          id: `co:${co.id}`,
          when: new Date(ts),
          contactId: co.contact_id,
          contact: byId.get(co.contact_id),
          icon: isApproved ? Check : FileEdit,
          tone: isApproved ? 'green' : 'neutral',
          title: isApproved
            ? `CO #${co.sequence_number} approved`
            : `CO #${co.sequence_number} added`
        })
      }
      for (const inv of invoices || []) {
        if (inv.status === 'void') continue
        out.push({
          id: `inv:${inv.id}`,
          when: new Date(inv.issued_at || inv.created_at),
          contactId: inv.contact_id,
          contact: byId.get(inv.contact_id),
          icon: Receipt,
          tone: inv.status === 'paid' ? 'green' : 'gold',
          title: `Draw #${inv.sequence_number}${inv.status === 'paid' ? ' paid' : ''}`
        })
      }

      const sorted = out
        .filter((e) => e.when instanceof Date && !Number.isNaN(e.when.getTime()))
        .sort((a: any, b: any) => b.when.getTime() - a.when.getTime())
        .slice(0, 5)
      setEvents(sorted)
    })()
    return () => { cancelled = true }
  }, [user?.id])

  if (events === null) return null
  if (events.length === 0) return null

  return (
    <section
      style={{
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        borderRadius: 14,
        overflow: 'hidden'
      }}
    >
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '12px 16px',
        borderBottom: '1px solid var(--v3-border)',
        background: 'var(--v3-surface-2)'
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: 'var(--v3-primary-bright)'
        }}>
          <ActivityIcon size={12} aria-hidden="true" />
          Recent activity
        </span>
        <Link
          to="/activity"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
            color: 'var(--v3-primary-bright)',
            textDecoration: 'none', letterSpacing: '0.04em'
          }}
        >
          See all <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {events.map((e: any, i: any) => <Row key={e.id} event={e} isLast={i === events.length - 1} />)}
      </ul>
    </section>
  )
}

function Row({ event, isLast }: any) {
  const Icon = event.icon
  const palette = ({
    neutral: { bg: 'rgba(255,255,255,0.06)', fg: 'var(--v3-text-muted)', br: 'rgba(255,255,255,0.10)' },
    gold:    { bg: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)', fg: 'var(--v3-primary-bright)', br: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)' },
    green:   { bg: 'rgba(74,222,128,0.10)', fg: 'var(--v3-success-bright, #4ade80)', br: 'rgba(74,222,128,0.30)' },
    red:     { bg: 'rgba(232,90,87,0.10)', fg: 'var(--v3-danger-bright, #f5a294)', br: 'rgba(232,90,87,0.30)' }
  } as Record<string, any>)[event.tone || 'neutral']
  const jobName = event.contact?.name || event.contact?.job_title || 'Unknown job'

  return (
    <li>
      <Link
        to={`/jobs/${event.contactId}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '28px 1fr auto',
          gap: 10,
          padding: '11px 16px',
          borderTop: '1px solid var(--v3-border)',
          textDecoration: 'none',
          color: 'inherit',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <span aria-hidden="true" style={{
          width: 28, height: 28, borderRadius: 8,
          background: palette.bg, border: `1px solid ${palette.br}`,
          color: palette.fg,
          display: 'grid', placeItems: 'center', flexShrink: 0
        }}>
          <Icon size={13} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
            color: 'var(--v3-text)', lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {event.title}
          </div>
          <div style={{
            marginTop: 2,
            fontFamily: 'var(--font-body)', fontSize: 10,
            color: 'var(--v3-text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {jobName}
          </div>
        </div>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600,
          color: 'var(--v3-text-faint, var(--v3-text-muted))',
          fontVariantNumeric: 'tabular-nums',
          alignSelf: 'center', whiteSpace: 'nowrap'
        }}>
          {relTime(event.when)}
        </span>
      </Link>
    </li>
  )
}
