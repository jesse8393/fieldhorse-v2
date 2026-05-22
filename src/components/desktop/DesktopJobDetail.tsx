import { useMemo } from 'react'
import {
  ChevronLeft, Phone, MessageSquare, Mail, Pencil, Plus,
  CalendarPlus, Users, ShieldCheck, MapPin, Clock,
  ArrowRight, Receipt
} from 'lucide-react'
import { hapticTap, hapticMedium } from '../../lib/haptics.ts'
import { stageColor } from '../../lib/stages.ts'
import { tabsForStage } from '../../screens/ContactDetail/lib/stageWorkspace.ts'
import OverviewTab_ from '../../screens/ContactDetail/tabs/Overview.tsx'
import QuoteTab_ from '../../screens/ContactDetail/tabs/Quote.tsx'
import DetailsTab_ from '../../screens/ContactDetail/tabs/Details.tsx'
import FinancialsTab_ from '../../screens/ContactDetail/tabs/Financials.tsx'
import FilesTab_ from '../../screens/ContactDetail/tabs/Files.tsx'
// Aliased as any-prop until the ContactDetail tabs are converted to .tsx
// with optional props; these desktop usages pass a subset by design.
const OverviewTab = OverviewTab_ as any
const QuoteTab = QuoteTab_ as any
const DetailsTab = DetailsTab_ as any
const FinancialsTab = FinancialsTab_ as any
const FilesTab = FilesTab_ as any

/**
 * DesktopJobDetail — Phase 8 desktop composition for /jobs/:id at >=900px.
 *
 * Renders only when tab !== 'quote' (Quote tab keeps the Phase 4
 * workspace via the existing flow). Composition patterned on
 * _reference/fieldhorse-v3-design/desktop-flows-1.jsx::DesktopJobDetail
 * but uses real Supabase data + handlers; never copies static arrays.
 *
 *   ┌─ header ──────────────────────────────────────────────────────┐
 *   │ ← Back · {client} · {Job}                       [Call][Text]  │
 *   │   eyebrow: JOB · {id-prefix} · {STAGE}              [Edit][⋯] │
 *   │   {job_title or name} (serif H1 with gold-italic accent)      │
 *   │   {client} · {address} · {next event hint}                    │
 *   │   [stage-pill] [balance-pill]                                 │
 *   ├─ financial strip (only when contract value) ────────────────┤
 *   │   CONTRACT  $X        BILLED  $Y (bar)        BALANCE  $Z   │
 *   ├─ tab nav ─────────────────────────────────────────────────────┤
 *   │   Overview  Quote  Details  Financials  Files                │
 *   ├─ work area (1.5fr / 1fr) ───────────────────────────────────┤
 *   │ ┌──────────────────┐  ┌──────────────────────────────────┐  │
 *   │ │ {tab content}    │  │ Next action                       │  │
 *   │ │  (existing tab   │  │ Client card                       │  │
 *   │ │   components)    │  │ Schedule peek                     │  │
 *   │ └──────────────────┘  └──────────────────────────────────┘  │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The existing tab components (OverviewTab, DetailsTab, FinancialsTab,
 * FilesTab) render INSIDE the left column — their internal structure
 * is mobile-tuned but reads better when constrained to ~62% of the
 * canvas with a context rail beside them.
 */

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'quote',      label: 'Quote' },
  { id: 'details',    label: 'Details' },
  { id: 'financials', label: 'Financials' },
  { id: 'files',      label: 'Files' }
]

const STAGE_LABEL: Record<string, string> = {
  lead:    'Lead',
  quote:   'Quote',
  job:     'Active',
  active:  'Active',
  invoice: 'Invoicing',
  closed:  'Closed',
  lost:    'Lost'
}

function money(n: any) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function shortMoney(n: any) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `$${Math.round(v / 1_000)}K`
  return money(v)
}
function initials(name: any) {
  if (!name) return '·'
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

function nextScheduleEvent(scheduleItems: any) {
  if (!Array.isArray(scheduleItems)) return null
  const now = Date.now()
  const upcoming = scheduleItems
    .map((e) => {
      const t = e.start_at || e.starts_at || e.scheduled_at || e.date
      const ms = t ? new Date(t).getTime() : 0
      return { evt: e, ms }
    })
    .filter((x) => Number.isFinite(x.ms) && x.ms > now - 1000 * 60 * 60 * 6)
    .sort((a, b) => a.ms - b.ms)
  return upcoming[0] || null
}

export default function DesktopJobDetail({
  contact, clientSummary,
  scheduleItems, todos, notes, subs, expenses, payments, inspections,
  paid, balance, scheduleCount,
  nextAction, nextTodo,
  tab, setTab,
  userId, isEditing, fetchAll, patch,
  onBack, onEdit, onMarkLost, onDelete, onClientNav, onTodoDone,
  onOpenLogPayment, onOpenAddEvent, onOpenInvitePartner, onOpenApproveQuote
}: any) {
  const contractValue = Number(contact?.amount || 0)
  const stageKey = String(contact?.stage || 'lead').toLowerCase()
  const visibleTabs = TABS.filter((t) => tabsForStage(stageKey).includes(t.id as any))
  const stageLabel = STAGE_LABEL[stageKey] || stageKey
  const sc = stageColor(stageKey)
  const billedPct = contractValue > 0 ? Math.min(100, Math.round((Number(paid || 0) / contractValue) * 100)) : 0
  const remaining = Math.max(0, contractValue - Number(paid || 0))
  const nextEvt = useMemo(() => nextScheduleEvent(scheduleItems), [scheduleItems])

  const phoneHref = contact?.phone ? `tel:${contact.phone}` : null
  const smsHref = contact?.phone ? `sms:${contact.phone}` : null
  const emailHref = contact?.email ? `mailto:${contact.email}` : null

  const titleText = contact?.job_title || contact?.name || 'Untitled job'
  const clientName = clientSummary?.name || contact?.name || null
  const idShort = contact?.id ? String(contact.id).slice(0, 8).toUpperCase() : ''

  return (
    <div className="dt-jobdetail">
      {/* HEADER */}
      <header className="dt-jobdetail__head">
        <button type="button" className="dt-jobdetail__back" onClick={onBack} aria-label="Back to jobs">
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Jobs</span>
        </button>

        <div className="dt-jobdetail__head-row">
          <div className="dt-jobdetail__head-text">
            <span className="dt-jobdetail__eyebrow">
              {idShort && <>JOB · {idShort} · </>}
              <strong style={{ color: sc }}>{stageLabel.toUpperCase()}</strong>
            </span>
            <h1 className="dt-jobdetail__h1">
              {titleText}
            </h1>
            <p className="dt-jobdetail__sub">
              {[
                clientName,
                contact?.address,
                nextEvt && nextEvt.evt?.title
                  ? `next: ${nextEvt.evt.title}`
                  : null
              ].filter(Boolean).join(' · ')}
            </p>
            <div className="dt-jobdetail__pill-row">
              <span className="dt-pill dt-pill--gold">
                <span className="dt-pill__dot" style={{ background: sc, boxShadow: `0 0 6px ${sc}80` }} />
                {stageLabel}
              </span>
              {balance > 0.5 && (
                <span className="dt-pill dt-pill--alert">
                  {money(balance)} balance
                </span>
              )}
              {contact?.proposal_status === 'sent' && stageKey === 'quote' && (
                <span className="dt-pill dt-pill--gold">Quote sent</span>
              )}
              {contact?.proposal_status === 'approved' && (
                <span className="dt-pill dt-pill--good">
                  <ShieldCheck size={11} aria-hidden="true" /> Approved
                </span>
              )}
            </div>
          </div>

          <div className="dt-jobdetail__head-actions">
            {phoneHref && (
              <a className="dt-icon-btn" href={phoneHref} aria-label="Call" onClick={hapticTap}>
                <Phone size={14} aria-hidden="true" />
              </a>
            )}
            {smsHref && (
              <a className="dt-icon-btn" href={smsHref} aria-label="Text" onClick={hapticTap}>
                <MessageSquare size={14} aria-hidden="true" />
              </a>
            )}
            <button type="button" className="dt-icon-btn" onClick={onEdit} aria-label="Edit" title="Edit">
              <Pencil size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="dt-pill-btn"
              onClick={() => { hapticMedium(); onOpenAddEvent?.() }}
            >
              <CalendarPlus size={13} aria-hidden="true" />
              Add event
            </button>
          </div>
        </div>
      </header>

      {/* FINANCIAL STRIP — only when contract value */}
      {contractValue > 0 && (
        <div className="dt-jobdetail__finstrip">
          <FinCell
            label="Contract"
            value={money(contractValue)}
            sub={contact?.proposal_status === 'approved' ? 'Approved' : (contact?.proposal_status === 'sent' ? 'Quote sent' : 'Draft')}
          />
          <FinCell
            label="Billed"
            value={money(paid || 0)}
            sub={`${billedPct}% of contract · ${shortMoney(remaining)} remaining`}
            progress={billedPct}
          />
          <FinCell
            label="Balance"
            value={money(balance || 0)}
            sub={(balance || 0) > 0.5 ? 'Awaiting payment' : 'Up to date'}
            tone={(balance || 0) > 0.5 ? 'alert' : 'muted'}
          />
        </div>
      )}

      {/* TAB NAV */}
      <nav className="dt-jobdetail__tabs" aria-label="Job sections">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dt-tab${tab === t.id ? ' is-on' : ''}`}
            onClick={() => { hapticTap(); setTab(t.id) }}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* WORK AREA — 5/17 chrome unification: Quote tab now also renders
          inside DesktopJobDetail so all 5 tabs share the same back
          button, eyebrow, financial strip, and tab nav (fixes the
          5/13 audit's "two design systems on one page" complaint where
          Overview used the dt-jobdetail chrome but Quote dropped to the
          mobile shell with different back button + uppercase tabs).
          When Quote is active we hide the right rail so the Quote
          builder's 2-pane workspace (.v3-screen--quote-active) gets
          full width — its own approval/context column lives inside the
          tab. */}
      <div
        className={`dt-jobdetail__work${tab === 'quote' ? ' dt-jobdetail__work--quote' : ''}`}
      >
        <div className="dt-jobdetail__main">
          {tab === 'overview' && (
            <OverviewTab
              contact={contact}
              notes={notes}
              payments={payments}
              scheduleItems={scheduleItems}
              todos={todos}
              paid={paid}
              balance={balance}
              userId={userId}
              fetchAll={fetchAll}
              patch={patch}
              isEditing={isEditing}
              onExitEdit={() => onEdit?.()}
              onOpenAddEvent={onOpenAddEvent}
              onOpenLogPayment={onOpenLogPayment}
              onOpenInvitePartner={onOpenInvitePartner}
              onOpenApproveQuote={onOpenApproveQuote}
            />
          )}
          {tab === 'quote' && (
            <QuoteTab
              contact={contact}
              userId={userId}
              fetchAll={fetchAll}
              patch={patch}
              onOpenApprove={onOpenApproveQuote}
            />
          )}
          {tab === 'details' && (
            <DetailsTab
              contact={contact}
              inspections={inspections}
              scheduleItems={scheduleItems}
              userId={userId}
              fetchAll={fetchAll}
              patch={patch}
              onOpenAddEvent={onOpenAddEvent}
              onOpenInvitePartner={onOpenInvitePartner}
            />
          )}
          {tab === 'financials' && (
            <FinancialsTab
              contact={contact}
              subs={subs}
              expenses={expenses}
              payments={payments}
              paid={paid}
              balance={balance}
              userId={userId}
              fetchAll={fetchAll}
              onOpenLogPayment={onOpenLogPayment}
            />
          )}
          {tab === 'files' && (
            <FilesTab
              contact={contact}
              notes={notes}
              userId={userId}
              fetchAll={fetchAll}
            />
          )}
        </div>

        {tab !== 'quote' && (
          <aside className="dt-jobdetail__rail">
            <NextActionCard
              nextAction={nextAction}
              nextTodo={nextTodo}
              onTodoDone={onTodoDone}
              onOpenAddEvent={onOpenAddEvent}
              onOpenApproveQuote={onOpenApproveQuote}
              stage={stageKey}
              onGoToQuote={() => setTab('quote')}
            />
            <ClientCard
              contact={contact}
              clientSummary={clientSummary}
              phoneHref={phoneHref}
              smsHref={smsHref}
              emailHref={emailHref}
              onClientNav={onClientNav}
              onOpenInvitePartner={onOpenInvitePartner}
            />
            <ScheduleCard
              scheduleItems={scheduleItems}
              scheduleCount={scheduleCount}
              onOpenAddEvent={onOpenAddEvent}
            />
            {(balance || 0) > 0.5 && (
              <BalanceCard
                balance={balance}
                paid={paid}
                contract={contractValue}
                onLogPayment={onOpenLogPayment}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function FinCell({ label, value, sub, progress, tone }: any) {
  return (
    <div className={`dt-jobdetail__fincell${tone === 'alert' ? ' dt-jobdetail__fincell--alert' : ''}`}>
      <span className="dt-jobdetail__fincell-label">{label}</span>
      <span className="dt-jobdetail__fincell-value">{value}</span>
      {Number.isFinite(progress) && (
        <div className="dt-jobdetail__fincell-bar" aria-hidden="true">
          <div className="dt-jobdetail__fincell-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {sub && <span className="dt-jobdetail__fincell-sub">{sub}</span>}
    </div>
  )
}

function NextActionCard({ nextAction, nextTodo, onTodoDone, onOpenAddEvent, onOpenApproveQuote, stage, onGoToQuote }: any) {
  // Surface whichever action the resolver picked. Fall back to a stage-
  // aware default so the rail never reads "no next action".
  const action = nextAction || (() => {
    if (stage === 'lead') return { kind: 'stage', title: 'Send a quote', cta: 'Open Quote tab', onCta: onGoToQuote }
    if (stage === 'quote') return { kind: 'stage', title: 'Get the quote approved', cta: 'Approve quote', onCta: onOpenApproveQuote }
    if (stage === 'job' || stage === 'active') return { kind: 'stage', title: 'Log progress + plan next site visit', cta: 'Add event', onCta: onOpenAddEvent }
    if (stage === 'invoice') return { kind: 'stage', title: 'Collect payment', cta: 'Open Financials', onCta: null }
    return { kind: 'stage', title: 'Job closed — keep records tight', cta: null }
  })()

  return (
    <section className="dt-card dt-jobdetail__rail-card dt-jobdetail__rail-card--gold" aria-label="Next action">
      <span className="dt-jobdetail__rail-eyebrow dt-jobdetail__rail-eyebrow--gold">Next action</span>
      <p className="dt-jobdetail__rail-title">
        {action?.title || 'No action queued.'}
      </p>
      {action?.dueAt && (
        <p className="dt-jobdetail__rail-sub">
          <Clock size={11} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {new Date(action.dueAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </p>
      )}
      <div className="dt-jobdetail__rail-cta-row">
        {nextTodo && action?.kind === 'todo' && (
          <button type="button" className="dt-pill-btn dt-pill-btn--primary" onClick={() => onTodoDone?.(nextTodo.id)}>
            Mark done
          </button>
        )}
        {action?.cta && action?.onCta && (
          <button type="button" className="dt-pill-btn" onClick={action.onCta}>
            {action.cta}
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  )
}

function ClientCard({ contact, clientSummary, phoneHref, smsHref, emailHref, onClientNav, onOpenInvitePartner }: any) {
  const name = clientSummary?.name || contact?.name || '—'
  return (
    <section className="dt-card dt-jobdetail__rail-card" aria-label="Client">
      <span className="dt-jobdetail__rail-eyebrow">Client</span>
      <div className="dt-jobdetail__client-head">
        <span className="dt-jobdetail__client-av" aria-hidden="true">{initials(name)}</span>
        <div className="dt-jobdetail__client-meta">
          <span className="dt-jobdetail__client-name">{name}</span>
          {contact?.address && (
            <span className="dt-jobdetail__client-sub">
              <MapPin size={11} aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 4 }} />
              {contact.address}
            </span>
          )}
          {contact?.phone && (
            <span className="dt-jobdetail__client-sub">{contact.phone}</span>
          )}
          {contact?.email && (
            <span className="dt-jobdetail__client-sub">{contact.email}</span>
          )}
        </div>
      </div>
      <div className="dt-jobdetail__client-actions">
        {phoneHref ? (
          <a className="dt-detail-btn" href={phoneHref} onClick={hapticTap}>
            <Phone size={13} aria-hidden="true" /> Call
          </a>
        ) : null}
        {smsHref ? (
          <a className="dt-detail-btn" href={smsHref} onClick={hapticTap}>
            <MessageSquare size={13} aria-hidden="true" /> Text
          </a>
        ) : null}
        {emailHref ? (
          <a className="dt-detail-btn" href={emailHref} onClick={hapticTap}>
            <Mail size={13} aria-hidden="true" /> Email
          </a>
        ) : null}
      </div>
      <div className="dt-jobdetail__client-foot">
        {contact?.client_id && onClientNav && (
          <button type="button" className="dt-pill-btn" onClick={() => { hapticTap(); onClientNav(contact.client_id) }}>
            Open client →
          </button>
        )}
        {onOpenInvitePartner && (
          <button type="button" className="dt-pill-btn" onClick={() => { hapticTap(); onOpenInvitePartner() }}>
            <Users size={12} aria-hidden="true" /> Invite partner
          </button>
        )}
      </div>
    </section>
  )
}

function ScheduleCard({ scheduleItems, scheduleCount, onOpenAddEvent }: any) {
  const upcoming = useMemo(() => {
    if (!Array.isArray(scheduleItems)) return []
    const now = Date.now()
    return scheduleItems
      .map((e) => ({ evt: e, ms: new Date(e.start_at || e.starts_at || e.scheduled_at || e.date || 0).getTime() }))
      .filter((x) => Number.isFinite(x.ms) && x.ms > now - 1000 * 60 * 60 * 6)
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 4)
  }, [scheduleItems])

  return (
    <section className="dt-card dt-jobdetail__rail-card" aria-label="Schedule">
      <div className="dt-jobdetail__rail-head">
        <span className="dt-jobdetail__rail-eyebrow">Schedule</span>
        <button type="button" className="dt-jobdetail__rail-link" onClick={() => { hapticMedium(); onOpenAddEvent?.() }}>
          <Plus size={11} aria-hidden="true" /> Add
        </button>
      </div>
      {upcoming.length === 0 ? (
        <p className="dt-jobdetail__rail-empty">No upcoming events.</p>
      ) : (
        <ul className="dt-jobdetail__sched-list">
          {upcoming.map(({ evt, ms }: any) => (
            <li key={evt.id} className="dt-jobdetail__sched-row">
              <span className="dt-jobdetail__sched-time">
                {new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                {' · '}
                {new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </span>
              <span className="dt-jobdetail__sched-title">
                {evt.title || evt.notes || 'Event'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(scheduleCount || 0) > upcoming.length && (
        <span className="dt-jobdetail__rail-foot">
          {scheduleCount} {scheduleCount === 1 ? 'event' : 'events'} total
        </span>
      )}
    </section>
  )
}

function BalanceCard({ balance, paid, contract, onLogPayment }: any) {
  const pct = contract > 0 ? Math.min(100, Math.round((Number(paid || 0) / contract) * 100)) : 0
  return (
    <section className="dt-card dt-jobdetail__rail-card dt-jobdetail__rail-card--alert" aria-label="Balance owed">
      <span className="dt-jobdetail__rail-eyebrow dt-jobdetail__rail-eyebrow--alert">
        <Receipt size={11} aria-hidden="true" /> Balance owed
      </span>
      <span className="dt-jobdetail__balance-value">{money(balance)}</span>
      {contract > 0 && (
        <>
          <div className="dt-jobdetail__balance-bar" aria-hidden="true">
            <div className="dt-jobdetail__balance-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="dt-jobdetail__rail-sub">{pct}% paid of {money(contract)}</span>
        </>
      )}
      <button
        type="button"
        className="dt-pill-btn dt-pill-btn--primary"
        onClick={() => { hapticMedium(); onLogPayment?.() }}
      >
        Log payment
      </button>
    </section>
  )
}
