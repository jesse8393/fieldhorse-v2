import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
const SnowClientDetailBuild = lazy(() => import('../components/desktop/SnowClientDetailBuild.tsx'))
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import {
  ChevronLeft, Pencil, X as XIcon, Save as SaveIcon,
  Briefcase, Paperclip, Image as ImageIcon, Download,
  Phone, Mail, MapPin, Trash2, MessageSquare, Users,
  Plus, Receipt, DollarSign, Clock
} from 'lucide-react'
import { hapticTap, hapticMedium, hapticError } from '../lib/haptics.ts'
import { SkeletonList } from '../components/Skeleton.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import CustomerBlockers from '../components/CustomerBlockers.tsx'
import { SegmentedTabs, Eyebrow, StampNumber } from '../components/v3'
import { tabPanelProps } from '../lib/tabs.ts'
import { supabase } from '../lib/supabase.ts'
import { useClientDetail, useInvalidateClientDetail, useInvalidateClients } from '../lib/queries.ts'
import { homeDashboardKey } from '../lib/homeDashboard.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { toastError, toastInfo } from '../lib/toast.ts'
import { stageColor, stageLabel } from '../lib/stages.ts'
import { recordRoute, type RecordKind } from '../lib/records.ts'
import { useSecondTap } from '../lib/secondTap.ts'
import { gatherStatement } from '../lib/statement.ts'
import { rollupJobs } from '../lib/rollups.ts'
import { composeClientTimeline, type TimelineEvent } from '../lib/clientTimeline.ts'

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function fmtPhone(n: any) {
  if (!n) return ''
  const digits = String(n).replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return n
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'projects', label: 'Projects' },
  { id: 'files',    label: 'Files' },
  { id: 'notes',    label: 'Notes' }
]

export default function ClientDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const orgId = useOrgScope(user?.id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const { data: bundle, isPending: loading, isError, refetch } = useClientDetail(id, user?.id)
  const invalidateClientDetail = useInvalidateClientDetail()
  const fetchClient = () => invalidateClientDetail(id)
  // The Clients list is a separate cached query; refresh it after any
  // change here so a deleted, renamed or edited client isn't stale there.
  const invalidateClients = useInvalidateClients()
  const client = bundle?.client ?? null
  const jobs = useMemo(() => bundle?.jobs ?? [], [bundle?.jobs])
  const leads = bundle?.leads ?? []
  const quotes = bundle?.quotes ?? []
  const invoices = bundle?.invoices ?? []
  const notes = bundle?.notes ?? []
  const files = bundle?.files ?? []
  const payments = useMemo(() => bundle?.payments ?? [], [bundle?.payments])
  const changeOrders = useMemo(() => bundle?.changeOrders ?? [], [bundle?.changeOrders])
  const [tab, setTab] = useState('overview')
  // Every row on the Projects tab opens its own record (D53).
  const openRecord = (kind: RecordKind, recordId: string) => navigate(recordRoute(kind, recordId))
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === 'contact')
  // Deleting the client takes a second tap on the same button (D57).
  const deleteTap = useSecondTap()
  const [deleting, setDeleting] = useState(false)
  // The statement is its own screen, every open invoice in one document.
  const openStatement = () => navigate(`/clients/${id}/statement`)

  // Derived metrics, the shared rollup, NOT an inline copy. The inline
  // version this replaced excluded closed jobs and approved change
  // orders from "outstanding", so this screen's tile could say $0 while
  // the statement button right below it billed the client $2,000.
  const rollup = useMemo(
    () => rollupJobs(jobs as any, payments as any, changeOrders as any),
    [jobs, payments, changeOrders]
  )
  const lifetime = rollup.lifetime
  const outstanding = rollup.outstanding
  const activeCount = rollup.activeCount

  // Statement rollup, the SAME computation the statement screen and PDF use,
  // so the "Statement · $X across N properties" button always agrees
  // with the document it opens (previously the button showed
  // `outstanding`/`activeCount`, which use different stage sets and could
  // disagree with the generated statement).
  const statementSummary = useMemo(
    () => gatherStatement(jobs as any, payments as any, changeOrders as any),
    [jobs, payments, changeOrders]
  )

  // The first tap arms the button, the second deletes.
  function requestDelete() {
    if (!client?.id || deleting) return
    deleteTap.tap(() => { void confirmDelete() })
  }

  // Writes match the client by id only. RLS keeps them inside the
  // company, and a user_id filter made a teammate's client silently
  // refuse every edit and delete. An empty result means nothing changed.
  async function confirmDelete() {
    if (!client?.id || deleting) return
    setDeleting(true)
    const { data, error } = await supabase.from('fh_clients').delete().eq('id', client.id).select('id')
    if (error || !data?.length) {
      setDeleting(false)
      toastError("Couldn't delete", error?.message || 'This client may already be gone. Refresh and try again.')
      return
    }
    toastInfo('Client deleted', 'Linked jobs unlinked')
    void invalidateClients()
    navigate('/clients')
  }

  // Save from OverviewEdit. A failed save keeps the editor open with the
  // typed values (it used to close as if saved and show the old ones).
  async function saveClientEdits(patch: any) {
    if (!client?.id) return
    const { data, error } = await supabase.from('fh_clients').update(patch).eq('id', client.id).select('id')
    if (error || !data?.length) {
      hapticError()
      toastError("Couldn't save", error?.message || 'This client may have been removed. Refresh and try again.')
      return
    }
    await fetchClient()
    void invalidateClients()
    // Today's follow up actions read the customer's current phone.
    if (user?.id && orgId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: homeDashboardKey(user.id, orgId) })
    }
    setIsEditing(false)
  }

  // New for this client (SPEC D58): the New screen, with this client
  // carried to every create screen, so no chooser opens here.
  function openNew() {
    if (!client?.id) return
    hapticTap()
    navigate(`/new?client=${encodeURIComponent(client.id)}`)
  }

  // Rules-of-hooks: useIsDesktop must run before any conditional
  // return, so React sees the same hook order on every render of
  // this component (loading → not-found → desktop branch → mobile).
  const isDesktop = useIsDesktop()

  if (loading) {
    return (
      <div className="v3-screen" style={{ paddingBottom: 48, padding: '24px 24px 48px', background: 'var(--v3-bg)' }}>
        <SkeletonList rows={4} card={false} />
      </div>
    )
  }

  // A failed load is not a missing client: say so and offer a retry
  // instead of "Client not found."
  if (isError && !bundle) {
    return (
      <div className="v3-screen" style={{ padding: '24px 24px 48px', background: 'var(--v3-bg)' }}>
        <button type="button" onClick={() => navigate('/clients')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--v3-primary-text)', fontWeight: 700, cursor: 'pointer' }}>← Back to clients</button>
        <div style={{ marginTop: 12 }}>
          <DataErrorState
            title="Couldn't load this client"
            message="Check your connection and retry. Nothing was lost."
            onRetry={() => { void refetch() }}
          />
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="v3-screen" style={{ padding: '24px 24px 48px', background: 'var(--v3-bg)' }}>
        <button type="button" onClick={() => navigate('/clients')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--v3-primary-text)', fontWeight: 700, cursor: 'pointer' }}>← Back to clients</button>
        <p style={{ color: 'var(--v3-text-muted)', marginTop: 12 }}>Client not found.</p>
      </div>
    )
  }

  const initial = (client.name || '·').trim().charAt(0).toUpperCase()

  // The tab body is the only piece we want to render inside the
  // desktop Build chrome, everything else (top bar, hero, tabs) is
  // already provided by SnowClientDetailBuild. The mobile branch
  // below renders the original chrome + this same body unchanged.
  const tabBody = (
    <>
      {tab === 'overview' && (
        isEditing
          ? <OverviewEdit client={client} onCommit={saveClientEdits} onCancel={() => setIsEditing(false)} />
          : <OverviewRead client={client} lifetime={lifetime} outstanding={outstanding} activeCount={activeCount} jobs={jobs} payments={payments} onJump={() => setTab('projects')} />
      )}
      {tab === 'activity' && (
        <ClientTimeline jobs={jobs} payments={payments} notes={notes} files={files} onOpen={(jobId: any) => jobId && navigate(`/jobs/${jobId}`)} />
      )}
      {tab === 'projects' && (
        <ProjectsList jobs={jobs} leads={leads} quotes={quotes} invoices={invoices} payments={payments} changeOrders={changeOrders} onOpen={openRecord} />
      )}
      {tab === 'files' && <FilesList rows={files} />}
      {tab === 'notes' && <NotesList notes={notes} />}
    </>
  )

  if (isDesktop) {
    return (
      <Suspense fallback={null}>
        <SnowClientDetailBuild
          client={client}
          lifetime={lifetime}
          outstanding={outstanding}
          activeCount={activeCount}
          jobs={jobs}
          payments={payments}
          tabs={TABS}
          activeTab={tab}
          onTabChange={setTab}
          onBack={() => navigate('/clients')}
          onEdit={() => setIsEditing(!isEditing)}
          onDelete={requestDelete}
          deleteArmed={deleteTap.armed}
          onNewDeal={openNew}
          onStatement={statementSummary.totalDue > 0 ? openStatement : undefined}
          isEditing={isEditing}
        >
          {tabBody}
        </SnowClientDetailBuild>
      </Suspense>
    )
  }

  return (
    <motion.div
      className="v3-screen fh-client-detail"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ paddingBottom: 48, position: 'relative', background: 'var(--v3-bg)' }}
    >

      {/* TOP BAR, back chevron + edit + delete in the chrome row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 24px 12px' }}>
        <IconBtn onClick={() => navigate('/clients')} ariaLabel="Back to clients">
          <ChevronLeft size={18} />
        </IconBtn>
        <div style={{ display: 'flex', gap: 8 }}>
          <IconBtn
            onClick={() => { hapticTap(); setIsEditing((v) => !v) }}
            ariaLabel={isEditing ? 'Stop editing' : 'Edit client'}
            ariaPressed={isEditing}
            tone={isEditing ? 'primary' : undefined}
          >
            <Pencil size={16} />
          </IconBtn>
          {deleteTap.armed ? (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => { hapticError(); requestDelete() }}
              disabled={deleting}
              aria-label="Tap again to delete"
              title={`Tap again to delete ${client?.name || 'this client'}. Linked jobs keep running, they just lose the client link.`}
              style={{
                minHeight: 40, padding: '0 12px', borderRadius: 10,
                background: 'rgba(192, 57, 43, 0.10)', border: '1px solid color-mix(in srgb, var(--v3-danger) 35%, transparent)',
                color: 'var(--v3-danger-text)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                whiteSpace: 'nowrap', cursor: 'pointer', WebkitTapHighlightColor: 'transparent'
              }}
            >
              Tap again to delete
            </motion.button>
          ) : (
            <IconBtn onClick={() => { hapticError(); requestDelete() }} ariaLabel="Delete client" tone="danger" disabled={deleting}>
              <Trash2 size={16} />
            </IconBtn>
          )}
        </div>
      </div>

      {/* COCKPIT, black-glass panel: hero + metrics + action row */}
      <div style={{ padding: '0 24px 12px' }}>
        <div className="fh-client-detail__hero">
          {/* Hero row, restrained avatar + name + active/company */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div aria-hidden="true" style={{
              flexShrink: 0,
              width: 60, height: 60,
              borderRadius: 10,
              background: 'var(--v3-surface-2)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
              display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              letterSpacing: 0,
              color: 'var(--v3-primary-text)',
              boxShadow: 'inset 0 1px 0 rgba(242, 237, 228, 0.05)'
            }}>
              {initial}
            </div>
            <div style={{ minWidth: 0, flex: 1, paddingTop: 4 }}>
              <h1 style={{
                margin: 0,
                fontSize: 24,
                lineHeight: 1.08,
                letterSpacing: 0,
                fontWeight: 600,
                color: 'var(--v3-text)'
              }}>
                {client.name}
              </h1>
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {activeCount > 0 ? (
                  <Eyebrow style={{ gap: 4, fontVariantNumeric: 'tabular-nums' }}>
                    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                    Active
                  </Eyebrow>
                ) : (
                  <Eyebrow style={{ gap: 4 }}>
                    Inactive
                  </Eyebrow>
                )}
                {client.company_name && (
                  <span style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: 'var(--v3-text-muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    minWidth: 0
                  }}>
                    {client.company_name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Metrics row, surfaces lifetime / outstanding / active */}
          {(lifetime > 0 || outstanding > 0 || activeCount > 0) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              alignItems: 'end',
              gap: 12,
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--v3-border)'
            }}>
              <CockpitMetric label="Lifetime" tone="gold" size="lg">
                {money(lifetime)}
              </CockpitMetric>
              <CockpitMetric
                label="Contract balance"
                tone={outstanding > 0 ? 'danger' : 'default'}
                size="md"
              >
                {money(outstanding)}
              </CockpitMetric>
              <CockpitMetric label="Active" size="md">
                {activeCount}
              </CockpitMetric>
            </div>
          )}

          {/* Action row, Call · Text · Email · Map (4 equal columns) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
            <ActionTile
              icon={Phone}
              label="Call"
              href={client.phone ? `tel:${client.phone}` : null}
            />
            <ActionTile
              icon={MessageSquare}
              label="Text"
              href={client.phone ? `sms:${client.phone}` : null}
            />
            <ActionTile
              icon={Mail}
              label="Email"
              href={client.email ? `mailto:${client.email}` : null}
            />
            <ActionTile
              icon={MapPin}
              label="Map"
              href={client.address ? `https://maps.apple.com/?address=${encodeURIComponent(client.address)}` : null}
              external
            />
          </div>
        </div>
      </div>

      {/* PRIMARY, spin up a new quote / job / invoice for this client */}
      <div style={{ padding: '0 24px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.99 }}
          onClick={openNew}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 10, border: 'none',
            background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, letterSpacing: 0,
            cursor: 'pointer', boxShadow: 'var(--v3-gold-glow)',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
          New quote or invoice
        </motion.button>

        {/* STATEMENT, roll every open invoice across all this client's
            properties into one document. Only meaningful when there's a
            balance, so it stays hidden otherwise. */}
        {statementSummary.totalDue > 0 && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.99 }}
            onClick={() => { hapticTap(); openStatement() }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 10,
              background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, letterSpacing: 0,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent'
            }}
          >
            <Receipt size={16} strokeWidth={2.2} aria-hidden="true" />
            Statement · {money(statementSummary.totalDue)} across {statementSummary.lines.length} {statementSummary.lines.length === 1 ? 'property' : 'properties'}
          </motion.button>
        )}
      </div>

      {/* TABS, v3 segmented underline (Overview · Projects · Files · Notes) */}
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={TABS}
        ariaLabel="Client tabs"
        idBase="fh-client-tabs"
      />

      {/* TAB CONTENT */}
      <div {...tabPanelProps('fh-client-tabs', tab)} style={{ padding: '0 24px' }}>
        {tab === 'overview' && (
          isEditing
            ? <OverviewEdit client={client} onCommit={saveClientEdits} onCancel={() => setIsEditing(false)} />
            : <OverviewRead client={client} lifetime={lifetime} outstanding={outstanding} activeCount={activeCount} jobs={jobs} payments={payments} onJump={() => setTab('projects')} />
        )}
        {tab === 'activity' && (
          <ClientTimeline jobs={jobs} payments={payments} notes={notes} files={files} onOpen={(jobId: any) => jobId && navigate(`/jobs/${jobId}`)} />
        )}
        {tab === 'projects' && (
          <ProjectsList jobs={jobs} leads={leads} quotes={quotes} invoices={invoices} payments={payments} changeOrders={changeOrders} onOpen={openRecord} />
        )}
        {tab === 'files' && <FilesList rows={files} />}
        {tab === 'notes' && <NotesList notes={notes} />}
      </div>
    </motion.div>
  )
}

/* ============================================================
   IconBtn, chrome icon button (back / edit / more / delete)
   ============================================================ */

function IconBtn({ children, onClick, ariaLabel, ariaPressed, tone, disabled }: any) {
  const palette = {
    primary: { bg: 'var(--v3-primary-soft)', border: 'color-mix(in srgb, var(--v3-primary) 45%, transparent)', color: 'var(--v3-primary-text)' },
    danger:  { bg: 'rgba(192, 57, 43, 0.10)', border: 'color-mix(in srgb, var(--v3-danger) 35%, transparent)', color: 'var(--v3-danger-text)' }
  }
  const p = (tone && (palette as any)[tone]) || { bg: 'var(--v3-surface)', border: 'var(--v3-border-strong)', color: 'var(--v3-text)' }
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.94 }}
      onClick={() => { if (!disabled) { hapticTap(); onClick?.() } }}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={{
        width: 44, height: 44, borderRadius: 'var(--fh-r-control)',
        display: 'grid', placeItems: 'center',
        background: p.bg,
        border: `1px solid ${p.border}`,
        color: p.color,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {children}
    </motion.button>
  )
}

/* ============================================================
   ActionTile, Call / Text / Email / Map quick-action button.
   Plain <a> + setTimeout fallback for iOS Safari (audit-batch-6 pattern).
   ============================================================ */

function ActionTile({ icon: Icon, label, href, external }: any) {
  const enabled = !!href
  const baseStyle: import('react').CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    padding: '12px 4px',
    borderRadius: 10,
    background: enabled ? 'var(--v3-surface-2)' : 'var(--v3-glass-tint)',
    border: `1px solid ${enabled ? 'var(--v3-border)' : 'var(--v3-border)'}`,
    color: enabled ? 'var(--v3-text)' : 'var(--v3-text-muted)',
    textDecoration: 'none',
    minHeight: 52,
    opacity: enabled ? 1 : 0.4,
    cursor: enabled ? 'pointer' : 'default',
    WebkitTapHighlightColor: 'transparent'
  }

  if (!enabled) {
    return (
      <div aria-disabled="true" style={baseStyle}>
        <Icon size={18} aria-hidden="true" />
        <Eyebrow>{label}</Eyebrow>
      </div>
    )
  }

  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={(e) => {
        hapticMedium()
        if (!external) {
          e.stopPropagation()
          if (typeof window !== 'undefined') {
            setTimeout(() => { window.location.href = href }, 0)
          }
        }
      }}
      aria-label={label}
      style={baseStyle}
    >
      <Icon size={20} aria-hidden="true" />
      <Eyebrow>{label}</Eyebrow>
    </a>
  )
}

/* ============================================================
   CockpitMetric, eyebrow + StampNumber column. Mirrors the
   Job Detail cockpit helper so both detail screens share scale.
   ============================================================ */

function CockpitMetric({ label, tone = 'default', size = 'md', children }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <Eyebrow tone={tone === 'gold' ? 'gold' : 'default'}>{label}</Eyebrow>
      <StampNumber size={size} tone={tone}>{children}</StampNumber>
    </div>
  )
}

/* ============================================================
   OverviewRead, Contact Info card + Map block (metrics now
   live in the cockpit header above)
   ============================================================ */

function OverviewRead({ client, lifetime, outstanding, activeCount, jobs = [], payments = [], onJump }: any) {
  return (
    <div className="fh-client-overview">

      <CustomerBlockers clientId={client.id} jobs={jobs} />

      {/* PIPELINE DISTRIBUTION, counts + value per stage, jumps to Projects */}
      {jobs.length > 0 && (
        <PipelineDistribution jobs={jobs} payments={payments} onJump={onJump} />
      )}

      {/* CONTACT INFO CARD, phone / email / address as separate rows */}
      <section className="fh-client-contact">
        <div style={{ padding: '12px 16px 8px' }}>
          <Eyebrow>
            Contact info
          </Eyebrow>
        </div>
        <ContactRow icon={Phone} label="Phone" value={fmtPhone(client.phone)} href={client.phone ? `tel:${client.phone}` : null} />
        <ContactRow icon={Mail} label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : null} />
        <ContactRow icon={MapPin} label="Address" value={client.address} multiline isLast />
      </section>

      {client.address && (
        <a
          className="fh-client-directions"
          href={`https://maps.apple.com/?address=${encodeURIComponent(client.address)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => hapticTap()}
        >
          <MapPin size={20} aria-hidden="true" />
          <span>{client.address}</span>
          <strong>Open in Maps →</strong>
        </a>
      )}

      {/* OPTIONAL, internal notes from the client record */}
      {client.notes && (
        <div className="fh-client-notes">
          <Eyebrow as="div" style={{ marginBottom: 8 }}>
            Internal notes
          </Eyebrow>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14, lineHeight: 1.5,
            color: 'var(--v3-text)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>
            {client.notes}
          </div>
        </div>
      )}
    </div>
  )
}

function ContactRow({ icon: Icon, label, value, href, multiline, isLast }: any) {
  const hasValue = !!value
  const inner = (
    <div style={{
      display: 'flex',
      alignItems: multiline ? 'flex-start' : 'center',
      gap: 12,
      padding: '12px 16px',
      borderTop: '1px solid var(--v3-border)',
      borderBottom: isLast ? 'none' : 'none',
      background: 'transparent',
      color: 'var(--v3-text)',
      textDecoration: 'none',
      cursor: hasValue && href ? 'pointer' : 'default',
      WebkitTapHighlightColor: 'transparent'
    }}>
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 36, height: 36, borderRadius: 10,
        background: hasValue ? 'var(--v3-primary-soft)' : 'var(--v3-glass-tint)',
        border: hasValue
          ? '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)'
          : '1px solid var(--v3-border)',
        color: hasValue ? 'var(--v3-primary-text)' : 'var(--v3-text-muted)',
        display: 'grid', placeItems: 'center'
      }}>
        <Icon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Eyebrow as="div" style={{ marginBottom: 4 }}>
          {label}
        </Eyebrow>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: hasValue ? 600 : 400,
          color: hasValue ? 'var(--v3-text)' : 'var(--v3-text-muted)',
          fontStyle: 'normal',
          lineHeight: 1.4,
          wordBreak: 'break-word',
          whiteSpace: multiline ? 'pre-wrap' : 'normal'
        }}>
          {value || 'Not set'}
        </div>
      </div>
    </div>
  )

  if (hasValue && href) {
    return (
      <a
        href={href}
        onClick={(e) => {
          hapticTap()
          e.stopPropagation()
          if (typeof window !== 'undefined') {
            setTimeout(() => { window.location.href = href }, 0)
          }
        }}
        style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
      >
        {inner}
      </a>
    )
  }
  return inner
}

/* ============================================================
   OverviewEdit, controlled form, v3 surface
   ============================================================ */

function OverviewEdit({ client, onCommit, onCancel }: any) {
  const [form, setForm] = useState({ ...client })
  const [saving, setSaving] = useState(false)
  function set(k: any, v: any) { setForm((f: any) => ({ ...f, [k]: v })) }
  const fieldStyle: import('react').CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '12px 12px', borderRadius: 10,
    background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
    fontSize: 16, minWidth: 0
  }
  const labelStyle: import('react').CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: 12, fontWeight: 700,
    letterSpacing: 0,
    color: 'var(--v3-text-muted)'
  }
  async function commit() {
    // fh_clients.name is required; a cleared name always failed to save.
    if (!String(form.name ?? '').trim()) {
      hapticError()
      toastError('Add a name', 'A client needs a name before you can save.')
      return
    }
    const EDITABLE = ['name', 'company_name', 'phone', 'email', 'address', 'notes']
    const patch: Record<string, any> = {}
    for (const k of EDITABLE) {
      const next = form[k]
      const prev = client[k]
      if ((next ?? null) !== (prev ?? null)) patch[k] = next === '' ? null : next
    }
    if (Object.keys(patch).length === 0) { onCancel(); return }
    setSaving(true)
    await onCommit(patch)
    setSaving(false)
  }
  return (
    <div style={{
      padding: '16px 0',
      background: 'transparent',
      display: 'flex', flexDirection: 'column', gap: 12,
      margin: '12px 0 24px'
    }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>Name</span>
        <input style={fieldStyle} value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>Company</span>
        <input style={fieldStyle} value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Phone</span>
          <input type="tel" inputMode="tel" style={fieldStyle} value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Email</span>
          <input type="email" inputMode="email" style={fieldStyle} value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>Address</span>
        <textarea rows={2} style={{ ...fieldStyle, resize: 'vertical' }} value={form.address || ''} onChange={(e) => set('address', e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>Notes</span>
        <textarea rows={4} style={{ ...fieldStyle, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 12, marginTop: 4 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={{
          padding: '12px 12px', borderRadius: 10,
          background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
          color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
          fontSize: 14, fontWeight: 700, cursor: 'pointer'
        }}>
          Cancel
        </button>
        <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={commit} disabled={saving} style={{
          padding: '12px 12px', borderRadius: 10, border: 'none',
          background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
          letterSpacing: 0,
          cursor: saving ? 'wait' : 'pointer',
          boxShadow: 'var(--v3-gold-glow)',
          opacity: saving ? 0.7 : 1
        }}>
          {saving ? 'Saving…' : 'Save changes'}
        </motion.button>
      </div>
    </div>
  )
}

/* ============================================================
   PipelineDistribution, overview mini-card. Counts + value per
   stage; tapping a row jumps to Projects (parent owns tab state).
   ============================================================ */

const PIPELINE_ROWS = [
  { id: 'lead',    label: 'Leads' },
  { id: 'quote',   label: 'Quotes' },
  { id: 'job',     label: 'Active jobs' },
  { id: 'closed',  label: 'Complete' },
  { id: 'lost',    label: 'Lost' }
]

function PipelineDistribution({ jobs, payments = [], onJump }: any) {
  const buckets = useMemo(() => {
    const out = Object.fromEntries(PIPELINE_ROWS.map((r) => [r.id, { count: 0, value: 0 }]))
    for (const j of jobs) {
      // Legacy 'invoice'-stage rows bucket under 'job' (their v2 home).
      const b = out[j.stage === 'invoice' ? 'job' : j.stage]
      if (!b) continue
      b.count += 1
      b.value += Number(j.amount || 0)
    }
    return out
  }, [jobs])
  const totalRevenue = useMemo(
    () => (payments || []).reduce((s: any, p: any) => s + Number(p.amount || 0), 0),
    [payments]
  )
  const visible = PIPELINE_ROWS.filter((r) => buckets[r.id].count > 0)
  if (visible.length === 0) return null
  const totalActive = visible.reduce((s, r) => s + buckets[r.id].count, 0)

  return (
    <section className="fh-client-pipeline">
      <header style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, padding: '12px 16px 8px'
      }}>
        <Eyebrow>
          Pipeline
        </Eyebrow>
        {totalRevenue > 0 && (
          <Eyebrow tone="success">
            {money(totalRevenue)} collected
          </Eyebrow>
        )}
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((r) => {
          const b = buckets[r.id]
          const c = stageColor(r.id)
          const pct = totalActive > 0 ? Math.round((b.count / totalActive) * 100) : 0
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => { hapticTap(); onJump?.() }}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '8px 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid var(--v3-border)',
                  textAlign: 'left',
                  color: 'inherit',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <span aria-hidden="true" style={{
                  width: 8, height: 8, borderRadius: 10,
                  background: c
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 14, fontWeight: 600,
                    color: 'var(--v3-text)', lineHeight: 1.2
                  }}>
                    {r.label}
                  </div>
                  <div style={{
                    marginTop: 4,
                    height: 4, borderRadius: 10,
                    background: 'var(--v3-glass-tint-2)',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${Math.max(pct, 4)}%`,
                      height: '100%',
                      background: c,
                      borderRadius: 10
                    }} />
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1
                  }}>
                    {b.count}
                  </div>
                  <div style={{
                    marginTop: 3,
                    fontFamily: 'var(--font-body)',
                    fontSize: 12, fontWeight: 600,
                    color: 'var(--v3-text-muted)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {money(b.value)}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ============================================================
   ProjectsList, jobs linked to this client, with stage filter
   chips + per-row paid/balance bar + relative-time stamp.
   ============================================================ */

function relTime(input: any) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// relTime gives "now", a short span ("5m", "3d") or a date ("Mar 5"),
// so "ago" only fits the spans.
function updatedLabel(stamp: string) {
  if (stamp === 'now') return 'Updated just now'
  if (/^\d+[mhdw]$/.test(stamp)) return `Updated ${stamp} ago`
  return `Updated ${stamp}`
}

/* ============================================================
   ClientTimeline, one chronological feed across all the client's
   properties: payments, projects, notes, files. Newest first.
   ============================================================ */
function ClientTimeline({ jobs, payments, notes, files, onOpen }: any) {
  const events = useMemo(
    () => composeClientTimeline(jobs, payments, notes, files),
    [jobs, payments, notes, files]
  )

  if (events.length === 0) {
    return (
      <div className="v3-empty" style={{ padding: '24px 16px', textAlign: 'center' }}>
        <Clock size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>No activity yet</div>
        <div style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>Payments, notes, and photos across this client's properties will show up here.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 0 24px' }}>
      {events.map((e: TimelineEvent, i: number) => {
        const meta = TIMELINE_META[e.kind]
        const last = i === events.length - 1
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => { hapticTap(); onOpen?.(e.contactId) }}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
              textAlign: 'left', background: 'none', border: 'none', padding: '4px 0',
              cursor: e.contactId ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent'
            }}
          >
            {/* Rail: dot + connecting line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch', flexShrink: 0, width: 26 }}>
              <span style={{ width: 26, height: 26, borderRadius: 10, display: 'grid', placeItems: 'center', background: meta.bg, border: `1px solid ${meta.border}`, color: meta.color }}>
                <meta.Icon size={13} />
              </span>
              {!last && <span style={{ flex: 1, width: 1.5, background: 'var(--v3-border)', marginTop: 2, minHeight: 14 }} />}
            </div>
            {/* Body */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--v3-text)' }}>{e.title}</span>
                {e.amount != null && e.amount > 0 && (
                  <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: 'var(--v3-success-text)', fontVariantNumeric: 'tabular-nums' }}>+{money(e.amount)}</span>
                )}
              </div>
              {e.detail && (
                <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.detail}</div>
              )}
              <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{timelineDate(e.atIso)}</span>
                {e.property && <><span aria-hidden="true">·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{e.property}</span></>}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

const TIMELINE_META: Record<string, { Icon: any; color: string; bg: string; border: string }> = {
  payment: { Icon: DollarSign, color: 'var(--v3-success-text)', bg: 'color-mix(in srgb, #2D7A4F 12%, transparent)', border: 'color-mix(in srgb, #2D7A4F 35%, transparent)' },
  job:     { Icon: Briefcase,  color: 'var(--v3-primary-text)', bg: 'var(--v3-primary-soft)', border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)' },
  note:    { Icon: MessageSquare, color: 'var(--v3-text-muted)', bg: 'var(--v3-surface-2)', border: 'var(--v3-border)' },
  file:    { Icon: ImageIcon, color: 'var(--v3-text-muted)', bg: 'var(--v3-surface-2)', border: 'var(--v3-border)' }
}

function timelineDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

const RECORD_ROW_STYLE = {
  width: '100%',
  position: 'relative',
  display: 'flex', flexDirection: 'column', gap: 12,
  padding: '12px 12px 12px 24px',
  borderRadius: 10,
  background: 'var(--v3-bg)',
  border: '1px solid var(--v3-border-strong)',
  boxShadow: 'inset 0 1px 0 var(--v3-glass-tint), 0 1px 2px rgba(20, 20, 20, 0.22)',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--v3-text)',
  overflow: 'hidden',
  WebkitTapHighlightColor: 'transparent'
} as const

const TITLE_STYLE = {
  fontFamily: 'var(--font-body)',
  fontSize: 14, fontWeight: 700,
  letterSpacing: 0,
  color: 'var(--v3-text)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
} as const

const DETAIL_STYLE = {
  marginTop: 3,
  fontFamily: 'var(--font-body)',
  fontSize: 12,
  color: 'var(--v3-text-muted)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
} as const

const AMOUNT_STYLE = {
  fontFamily: 'var(--font-display)',
  fontSize: 16,
  color: 'var(--v3-primary-text)',
  letterSpacing: 0,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1
} as const

/** The status of a lead, quote or invoice in a word. */
function statusWord(status: string | null | undefined) {
  const s = String(status || '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function RecordGroup({ heading, count, children }: { heading: string; count: number; children: any }) {
  const id = `fh-client-projects-${heading.toLowerCase()}`
  return (
    <section aria-labelledby={id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 id={id} style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--v3-text)', letterSpacing: 0 }}>
        {heading}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      </h3>
      {count === 0
        ? <div style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>None yet.</div>
        : <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</ul>}
    </section>
  )
}

/** One row of a group: a rail in the record's colour, a title, a detail line, a figure and a word. */
function RecordRow({ color, title, detail, figure, word, stamp, onOpen }: any) {
  return (
    <li>
      <motion.button
        type="button"
        whileTap={{ scale: 0.99 }}
        whileHover={{ y: -2, backgroundColor: 'var(--v3-surface-3)' }}
        transition={{ type: 'spring', stiffness: 620, damping: 28 }}
        onClick={() => { hapticTap(); onOpen() }}
        style={RECORD_ROW_STYLE}
      >
        <span aria-hidden="true" style={{
          position: 'absolute',
          left: 0, top: 12, bottom: 12,
          width: 3,
          borderRadius: '0 3px 3px 0',
          background: color,
          boxShadow: `0 0 12px ${color}66`
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={TITLE_STYLE}>{title}</div>
            <div style={DETAIL_STYLE}>{detail || '\u2003'}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            {figure != null && <div style={AMOUNT_STYLE}>{figure}</div>}
            {word && (
              <Eyebrow as="div" style={{ marginTop: figure != null ? 4 : 0, color }}>
                {word}
              </Eyebrow>
            )}
          </div>
        </div>
        {stamp && (
          <Eyebrow as="div" style={{ color: 'var(--v3-text-faint, var(--v3-text-muted))', fontVariantNumeric: 'tabular-nums' }}>
            {updatedLabel(stamp)}
          </Eyebrow>
        )}
      </motion.button>
    </li>
  )
}

/* ============================================================
   ProjectsList: the client's four kinds of record (D53), Leads,
   Quotes, Jobs and Invoices, each row opening its own screen.
   ============================================================ */
function ProjectsList({ jobs, leads = [], quotes = [], invoices = [], payments = [], changeOrders = [], onOpen }: any) {
  const paidByJob = useMemo(() => {
    const m = new Map()
    for (const p of payments || []) {
      if (!p.contact_id) continue
      m.set(p.contact_id, (m.get(p.contact_id) || 0) + Number(p.amount || 0))
    }
    return m
  }, [payments])

  // Approved change orders add to what each job is owed, the same rule
  // the cockpit (rollups.ts) and the statement use. Without them a fully
  // paid base contract read "Paid in full" while the CO was still due.
  const coByJob = useMemo(() => {
    const m = new Map()
    for (const co of changeOrders || []) {
      if (co?.status !== 'approved' || !co.contact_id) continue
      m.set(co.contact_id, (m.get(co.contact_id) || 0) + Number(co.amount || 0))
    }
    return m
  }, [changeOrders])

  if (jobs.length === 0 && leads.length === 0 && quotes.length === 0 && invoices.length === 0) {
    return <EmptyCard label="No records linked to this client yet." />
  }

  return (
    <div style={{ padding: '12px 0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <RecordGroup heading="Leads" count={leads.length}>
        {leads.map((l: any) => (
          <RecordRow
            key={l.id}
            color={stageColor('lead')}
            title={l.title || 'Untitled lead'}
            detail={[l.job_type, l.follow_up_on ? `Follow up ${new Date(`${l.follow_up_on}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}
            word={statusWord(l.status)}
            stamp={relTime(l.updated_at)}
            onOpen={() => onOpen('lead', l.id)}
          />
        ))}
      </RecordGroup>

      <RecordGroup heading="Quotes" count={quotes.length}>
        {quotes.map((q: any) => (
          <RecordRow
            key={q.id}
            color={stageColor('quote')}
            title={q.title || 'Untitled quote'}
            detail={q.job_id ? 'Made into a job' : q.sent_at ? `Sent ${new Date(q.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null}
            figure={money(q.amount)}
            word={statusWord(q.status)}
            stamp={relTime(q.updated_at)}
            onOpen={() => onOpen('quote', q.id)}
          />
        ))}
      </RecordGroup>

      <RecordGroup heading="Jobs" count={jobs.length}>
        {jobs.map((j: any) => {
          const c = stageColor(j.stage)
          const contract = Number(j.amount || 0) + (coByJob.get(j.id) || 0)
          const paid = paidByJob.get(j.id) || 0
          const billable = j.stage === 'job' || j.stage === 'invoice' || j.stage === 'closed'
          // Under 50 cents is rounding dust, as in rollups.ts.
          const balance = Math.max(0, contract - paid)
          const due = balance > 0.5
          const pct = contract > 0 ? Math.min(100, Math.round((paid / contract) * 100)) : 0
          const stamp = relTime(j.updated_at)
          return (
            <li key={j.id}>
              <motion.button
                type="button"
                whileTap={{ scale: 0.99 }}
                whileHover={{ y: -2, backgroundColor: 'var(--v3-surface-3)' }}
                transition={{ type: 'spring', stiffness: 620, damping: 28 }}
                onClick={() => { hapticTap(); onOpen('job', j.id) }}
                style={RECORD_ROW_STYLE}
              >
                <span aria-hidden="true" style={{
                  position: 'absolute',
                  left: 0, top: 12, bottom: 12,
                  width: 3,
                  borderRadius: '0 3px 3px 0',
                  background: c,
                  boxShadow: `0 0 12px ${c}66`
                }} />

                {/* Row 1, title + amount */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={TITLE_STYLE}>{j.name || 'Untitled'}</div>
                    <div style={DETAIL_STYLE}>{j.job_title || j.job_type || '\u2003'}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={AMOUNT_STYLE}>{money(contract)}</div>
                    <Eyebrow as="div" style={{ marginTop: 4, color: c }}>
                      {stageLabel(String(j.stage || ''))}
                    </Eyebrow>
                  </div>
                </div>

                {/* Row 2, paid bar (only when there's money to track) */}
                {contract > 0 && billable && (
                  <div>
                    <div style={{
                      height: 4, borderRadius: 10,
                      background: 'var(--v3-glass-tint-2)',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: pct >= 100 ? 'var(--v3-success-bright, #2D7A4F)' : c,
                        borderRadius: 10
                      }} />
                    </div>
                    <div style={{
                      marginTop: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 8,
                      fontFamily: 'var(--font-body)',
                      fontSize: 12, fontWeight: 600,
                      letterSpacing: 0,
                      color: 'var(--v3-text-muted)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      <span>
                        {money(paid)} paid{paid > 0 ? ` · ${pct}%` : ''}
                      </span>
                      <span style={{ color: due ? 'var(--v3-danger-text)' : 'var(--v3-success-text)' }}>
                        {due ? `${money(balance)} due` : 'Paid in full'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Row 3, last-touch stamp */}
                {stamp && (
                  <Eyebrow as="div" style={{ color: 'var(--v3-text-faint, var(--v3-text-muted))', fontVariantNumeric: 'tabular-nums' }}>
                    {updatedLabel(stamp)}
                  </Eyebrow>
                )}
              </motion.button>
            </li>
          )
        })}
      </RecordGroup>

      <RecordGroup heading="Invoices" count={invoices.length}>
        {invoices.map((inv: any) => (
          <RecordRow
            key={inv.id}
            color={stageColor('invoice')}
            title={inv.title || `Invoice ${inv.sequence_number || ''}`.trim()}
            detail={inv.due_at ? `Due ${new Date(inv.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null}
            figure={money(inv.amount)}
            word={statusWord(inv.status)}
            stamp={relTime(inv.updated_at || inv.created_at)}
            onOpen={() => onOpen('invoice', inv.id)}
          />
        ))}
      </RecordGroup>
    </div>
  )
}

/* ============================================================
   NotesList, communication log across all the client's jobs
   ============================================================ */

function NotesList({ notes }: any) {
  if (notes.length === 0) return <EmptyCard label="No notes on this client's jobs yet." />
  return (
    <div style={{ padding: '12px 0 24px' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.map((n: any) => {
          const body = n.text || n.body || ''
          const title = n.parsed?.summary || (body.split('\n').find((l: any) => l.trim()) || '').slice(0, 80) || 'Untitled'
          return (
            <li key={n.id} style={{
              position: 'relative',
              padding: '12px 12px 12px 24px',
              borderRadius: 10,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border-strong)',
              boxShadow: 'inset 0 1px 0 var(--v3-glass-tint), 0 1px 2px rgba(20, 20, 20, 0.22)',
              overflow: 'hidden'
            }}>
              <span aria-hidden="true" style={{
                position: 'absolute',
                left: 0, top: 12, bottom: 12,
                width: 3,
                borderRadius: '0 3px 3px 0',
                background: 'var(--v3-primary)',
                boxShadow: '0 0 12px rgba(201, 150, 58, 0.45)'
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <h4 style={{
                  margin: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 14, fontWeight: 700,
                  color: 'var(--v3-text)',
                  letterSpacing: 0,
                  overflowWrap: 'anywhere'
                }}>
                  {title}
                </h4>
                <span style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
              {body && body !== title && (
                <p style={{
                  margin: '6px 0 0',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  color: 'var(--v3-text-muted)',
                  whiteSpace: 'pre-wrap'
                }}>{body}</p>
              )}
              {n.fh_contacts?.name && (
                <Eyebrow tone="gold" style={{ gap: 4, marginTop: 8, padding: '4px 8px', borderRadius: 10, background: 'var(--v3-primary-soft)', border: '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)' }}>
                  <Briefcase size={10} />
                  {n.fh_contacts.name}
                </Eyebrow>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ============================================================
   FilesList, files + photos across the client's jobs
   ============================================================ */

function FilesList({ rows }: any) {
  if (rows.length === 0) return <EmptyCard label="No files or photos across this client's jobs." />
  function fmtSize(n: any) {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }
  async function open(row: any) {
    const bucket = row.kind === 'photo' ? 'job-photos' : 'job-files'
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(row.storage_path, 60 * 60)
    if (error || !data?.signedUrl) {
      toastError('Could not open', error?.message || 'Try again')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  return (
    <div style={{ padding: '12px 0 24px' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r: any) => (
          <li key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 12px',
            borderRadius: 10,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-border-strong)',
            boxShadow: 'inset 0 1px 0 var(--v3-glass-tint), 0 1px 2px rgba(20, 20, 20, 0.22)'
          }}>
            <span aria-hidden="true" style={{
              flexShrink: 0,
              width: 34, height: 34, borderRadius: 10,
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
              color: 'var(--v3-primary-text)',
              display: 'grid', placeItems: 'center'
            }}>
              {r.kind === 'photo' ? <ImageIcon size={15} /> : <Paperclip size={15} />}
            </span>
            <button type="button" onClick={() => open(r)} style={{
              flex: 1, minWidth: 0,
              background: 'transparent', border: 'none', padding: 0, textAlign: 'left',
              cursor: 'pointer', color: 'var(--v3-text)',
              WebkitTapHighlightColor: 'transparent'
            }}>
              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 14, fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {r.filename}
              </div>
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                color: 'var(--v3-text-muted)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {fmtSize(r.size_bytes)} · {r.fh_contacts?.name || 'job'} · {new Date(r.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
            </button>
            <button type="button" onClick={() => open(r)} aria-label="Open" style={{
              flexShrink: 0,
              width: 40, height: 40, borderRadius: 10,
              border: '1px solid var(--v3-border-strong)',
              background: 'transparent',
              color: 'var(--v3-text-muted)',
              cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}>
              <Download size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyCard({ label }: any) {
  return (
    <div className="v3-empty" style={{ margin: '12px 0 24px' }}>
      {label}
    </div>
  )
}
