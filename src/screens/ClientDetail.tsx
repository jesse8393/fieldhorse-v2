import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
const SnowClientDetailBuild = lazy(() => import('../components/desktop/SnowClientDetailBuild.tsx'))
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import {
  ChevronLeft, Pencil, X as XIcon, Save as SaveIcon,
  Briefcase, Paperclip, Image as ImageIcon, Download,
  Phone, Mail, MapPin, Trash2, MessageSquare, Users,
  Plus, FileText, Receipt
} from 'lucide-react'
import { hapticTap, hapticMedium, hapticError } from '../lib/haptics.ts'
import ActionSheet from '../components/ActionSheet.tsx'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { SkeletonList } from '../components/Skeleton.tsx'
import { SegmentedTabs, Eyebrow, StampNumber } from '../components/v3'
import { supabase } from '../lib/supabase.ts'
import { useClientDetail, useInvalidateClientDetail } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { toast, toastSuccess, toastInfo } from '../lib/toast.ts'
import { stageColor } from '../lib/stages.ts'

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
  { id: 'projects', label: 'Projects' },
  { id: 'files',    label: 'Files' },
  { id: 'notes',    label: 'Notes' }
]

export default function ClientDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: bundle, isPending: loading } = useClientDetail(id, user?.id)
  const invalidateClientDetail = useInvalidateClientDetail()
  const fetchClient = () => invalidateClientDetail(id)
  const client = bundle?.client ?? null
  const jobs = bundle?.jobs ?? []
  const notes = bundle?.notes ?? []
  const files = bundle?.files ?? []
  const payments = bundle?.payments ?? []
  const [tab, setTab] = useState('overview')
  const [isEditing, setIsEditing] = useState(false)
  // Destructive-confirm sheet state for delete client.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // "New" chooser sheet — spin up a quote / job / invoice under this client.
  const [newOpen, setNewOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // Derived metrics — computed from jobs[] + payments[].
  // Lifetime: sum of every job amount under this client, all stages.
  // Outstanding: sum of (amount - paid) for jobs in billing pipeline
  // (job + invoice stages). Closed/lost jobs drop out automatically.
  const lifetime = useMemo(
    () => (jobs || []).reduce((s, j) => s + Number(j.amount || 0), 0),
    [jobs]
  )
  const outstanding = useMemo(() => {
    const paidByJob = new Map()
    for (const p of payments || []) {
      if (!p.contact_id) continue
      paidByJob.set(p.contact_id, (paidByJob.get(p.contact_id) || 0) + Number(p.amount || 0))
    }
    return (jobs || [])
      .filter((j) => j.stage === 'job' || j.stage === 'invoice')
      .reduce((s, j) => {
        const bal = Number(j.amount || 0) - (paidByJob.get(j.id) || 0)
        return s + Math.max(0, bal)
      }, 0)
  }, [jobs, payments])
  const activeCount = useMemo(
    () => (jobs || []).filter((j) => ['lead', 'quote', 'job', 'invoice'].includes(j.stage as string)).length,
    [jobs]
  )

  // Open the destructive-confirm sheet. The header trash button hits this.
  function requestDelete() {
    if (!client?.id) return
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!client?.id || deleting) return
    setDeleting(true)
    const { error } = await supabase.from('fh_clients').delete().eq('id', client.id).eq('user_id', user!.id)
    if (error) {
      setDeleting(false)
      setDeleteOpen(false)
      toast({ kind: 'error', title: "Couldn't delete", body: error.message } as any)
      return
    }
    toastInfo('Client deleted', 'Linked jobs unlinked')
    navigate('/clients')
  }

  // Create a new deal under this client at the chosen kind, prefilled
  // with the client's contact info, then jump straight into it. A quote
  // lands on the Quote builder; an "invoice" (materials/quick job, no
  // quote needed) is a job in v2 — it lands on Financials where the
  // Send Invoice flow lives; a job lands on Overview.
  async function createDealForClient(stage: 'quote' | 'job' | 'invoice') {
    if (!client?.id || !user?.id || creating) return
    setCreating(true)
    const payload = {
      user_id: user.id,
      name: client.name || 'New ' + (stage === 'invoice' ? 'invoice' : stage),
      phone: client.phone || null,
      email: client.email || null,
      address: client.address || null,
      amount: 0,
      // 'invoice' isn't a stage anymore (pipeline v2) — a quick
      // standalone invoice is a job you bill immediately.
      stage: stage === 'invoice' ? 'job' : stage,
      client_id: client.id
    }
    const { data, error } = await supabase.from('fh_contacts').insert(payload).select().single()
    if (error) {
      setCreating(false)
      toast({ kind: 'error', title: "Couldn't create", body: error.message } as any)
      return
    }
    hapticMedium()
    await fetchClient()
    setCreating(false)
    setNewOpen(false)
    const dest = stage === 'invoice' ? '?tab=financials' : stage === 'quote' ? '?tab=quote' : ''
    navigate(`/jobs/${data.id}${dest}`)
  }

  // Rules-of-hooks: useIsDesktop must run before any conditional
  // return, so React sees the same hook order on every render of
  // this component (loading → not-found → desktop branch → mobile).
  const isDesktop = useIsDesktop()

  if (loading) {
    return (
      <div className="v3-screen" style={{ paddingBottom: 120, padding: '20px 20px 120px', background: 'var(--v3-bg)' }}>
        <SkeletonList rows={4} card={false} />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="v3-screen" style={{ padding: '20px 20px 120px', background: 'var(--v3-bg)' }}>
        <button type="button" onClick={() => navigate('/clients')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--v3-primary)', fontWeight: 700, cursor: 'pointer' }}>← Back to clients</button>
        <p style={{ color: 'var(--v3-text-muted)', marginTop: 12 }}>Client not found.</p>
      </div>
    )
  }

  const initial = (client.name || '·').trim().charAt(0).toUpperCase()

  // The tab body is the only piece we want to render inside the
  // desktop Build chrome — everything else (top bar, hero, tabs) is
  // already provided by SnowClientDetailBuild. The mobile branch
  // below renders the original chrome + this same body unchanged.
  const tabBody = (
    <>
      {tab === 'overview' && (
        isEditing
          ? <OverviewEdit client={client} onCommit={async (patch: any) => { await supabase.from('fh_clients').update(patch).eq('id', client.id).eq('user_id', user!.id); await fetchClient(); setIsEditing(false) }} onCancel={() => setIsEditing(false)} />
          : <OverviewRead client={client} lifetime={lifetime} outstanding={outstanding} activeCount={activeCount} jobs={jobs} payments={payments} onJump={() => setTab('projects')} />
      )}
      {tab === 'projects' && (
        <ProjectsList jobs={jobs} payments={payments} onOpen={(jobId: any) => navigate(`/jobs/${jobId}`)} />
      )}
      {tab === 'files' && <FilesList rows={files} />}
      {tab === 'notes' && <NotesList notes={notes} />}
    </>
  )

  if (isDesktop) {
    return (
      <Suspense fallback={null}><SnowClientDetailBuild
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
        onDelete={() => setDeleteOpen(true)}
        onNewDeal={() => setNewOpen(true)}
        isEditing={isEditing}
      >
        {tabBody}
      </SnowClientDetailBuild></Suspense>
    )
  }

  return (
    <motion.div
      className="v3-screen"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >

      {/* TOP BAR — back chevron + edit + delete in the chrome row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 20px 10px' }}>
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
          <IconBtn onClick={() => { hapticError(); requestDelete() }} ariaLabel="Delete client" tone="danger">
            <Trash2 size={16} />
          </IconBtn>
        </div>
      </div>

      {/* COCKPIT — black-glass panel: hero + metrics + action row */}
      <div style={{ padding: '0 20px 14px' }}>
        <div style={{
          padding: '12px 14px',
          borderRadius: 16,
          background: 'linear-gradient(180deg, #1b1816 0%, #121010 72%)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.06) inset, 0 1px 2px rgba(0, 0, 0, 0.40), 0 8px 22px rgba(0, 0, 0, 0.42), 0 20px 44px rgba(0, 0, 0, 0.28)'
        }}>
          {/* Hero row — restrained avatar + name + active/company */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div aria-hidden="true" style={{
              flexShrink: 0,
              width: 60, height: 60,
              borderRadius: 16,
              background: 'var(--v3-surface-2)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
              display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              letterSpacing: '0.04em',
              color: 'var(--v3-primary)',
              boxShadow: 'inset 0 1px 0 rgba(255, 240, 210, 0.05)'
            }}>
              {initial}
            </div>
            <div style={{ minWidth: 0, flex: 1, paddingTop: 2 }}>
              <h1 style={{
                margin: 0,
                fontSize: 'clamp(22px, 5.5vw, 28px)',
                lineHeight: 1.08,
                letterSpacing: '-0.015em',
                fontWeight: 600,
                color: 'var(--v3-text)'
              }}>
                {client.name}
              </h1>
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {activeCount > 0 ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 8px', borderRadius: 999,
                    background: 'var(--v3-success-soft)',
                    border: '1px solid rgba(79, 140, 94, 0.40)',
                    color: 'var(--v3-success-bright)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--v3-success-bright)' }} />
                    Active
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '2px 8px', borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--v3-border-strong)',
                    color: 'var(--v3-text-muted)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase'
                  }}>
                    Inactive
                  </span>
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

          {/* Metrics row — surfaces lifetime / outstanding / active */}
          {(lifetime > 0 || outstanding > 0 || activeCount > 0) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              alignItems: 'end',
              gap: 10,
              marginTop: 12,
              paddingTop: 10,
              borderTop: '1px solid var(--v3-border)'
            }}>
              <CockpitMetric label="Lifetime" tone="gold" size="lg">
                {money(lifetime)}
              </CockpitMetric>
              <CockpitMetric
                label="Outstanding"
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

          {/* Action row — Call · Text · Email · Map (4 equal columns) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 12 }}>
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

      {/* PRIMARY — spin up a new quote / job / invoice for this client */}
      <div style={{ padding: '0 20px 12px' }}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.99 }}
          onClick={() => { hapticTap(); setNewOpen(true) }}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '13px 16px', borderRadius: 14, border: 'none',
            background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
            cursor: 'pointer', boxShadow: 'var(--v3-gold-glow)',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
          New quote or invoice
        </motion.button>
      </div>

      {/* TABS — v3 segmented underline (Overview · Projects · Files · Notes) */}
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={TABS}
        ariaLabel="Client tabs"
      />

      {/* TAB CONTENT */}
      <div style={{ padding: '0 20px' }}>
        {tab === 'overview' && (
          isEditing
            ? <OverviewEdit client={client} onCommit={async (patch: any) => { await supabase.from('fh_clients').update(patch).eq('id', client.id).eq('user_id', user!.id); await fetchClient(); setIsEditing(false) }} onCancel={() => setIsEditing(false)} />
            : <OverviewRead client={client} lifetime={lifetime} outstanding={outstanding} activeCount={activeCount} jobs={jobs} payments={payments} onJump={() => setTab('projects')} />
        )}
        {tab === 'projects' && (
          <ProjectsList jobs={jobs} payments={payments} onOpen={(jobId: any) => navigate(`/jobs/${jobId}`)} />
        )}
        {tab === 'files' && <FilesList rows={files} />}
        {tab === 'notes' && <NotesList notes={notes} />}
      </div>

      {/* Destructive-confirm sheet for delete client. Body preserves the
          existing nuance from the prior native confirm: jobs keep
          running but lose the client link. */}
      <ActionSheet
        open={deleteOpen}
        title="Delete this client?"
        accentWord="Delete"
        sectionLabel="Destructive"
        stepCount={1}
        currentStep={1}
        commitLabel={deleting ? 'Deleting…' : 'Delete client'}
        commitBusy={deleting}
        commitDisabled={deleting}
        destructive
        onClose={() => { if (!deleting) setDeleteOpen(false) }}
        onCommit={confirmDelete}
      >
        <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: '1rem', lineHeight: 1.45 }}>
          Removing <strong>{client?.name || 'this client'}</strong>. Linked jobs keep running — they just lose the client link.
        </p>
      </ActionSheet>

      {/* NEW-DEAL CHOOSER — quote / job / invoice, all linked to this client */}
      <Drawer open={newOpen} onOpenChange={(o: any) => { if (!o && !creating) setNewOpen(false) }}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>New for {client.name}</DrawerTitle>
            <DrawerDescription>Start a quote, a quick job, or a standalone invoice — all linked to this client.</DrawerDescription>
          </DrawerHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 16px max(16px, env(safe-area-inset-bottom))' }}>
            <NewDealOption icon={FileText} label="New quote" sub="Build an estimate to send" onClick={() => createDealForClient('quote')} disabled={creating} />
            <NewDealOption icon={Briefcase} label="New job" sub="Quick job — skip the quote" onClick={() => createDealForClient('job')} disabled={creating} />
            <NewDealOption icon={Receipt} label="New invoice" sub="Materials or misc — no quote needed" onClick={() => createDealForClient('invoice')} disabled={creating} />
          </div>
        </DrawerContent>
      </Drawer>
    </motion.div>
  )
}

/* ============================================================
   NewDealOption — one row in the "New for {client}" chooser sheet
   ============================================================ */

function NewDealOption({ icon: Icon, label, sub, onClick, disabled }: any) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.99 }}
      onClick={() => { if (!disabled) { hapticTap(); onClick?.() } }}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        width: '100%', textAlign: 'left',
        padding: '14px 16px', borderRadius: 14,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 40, height: 40, borderRadius: 11,
        background: 'var(--v3-primary-soft)',
        border: '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)',
        color: 'var(--v3-primary)',
        display: 'grid', placeItems: 'center'
      }}>
        <Icon size={18} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block',
          fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700,
          color: 'var(--v3-text)', lineHeight: 1.2
        }}>
          {label}
        </span>
        <span style={{
          display: 'block', marginTop: 2,
          fontFamily: 'var(--font-body)', fontSize: 12,
          color: 'var(--v3-text-muted)', lineHeight: 1.3
        }}>
          {sub}
        </span>
      </span>
    </motion.button>
  )
}

/* ============================================================
   IconBtn — chrome icon button (back / edit / more / delete)
   ============================================================ */

function IconBtn({ children, onClick, ariaLabel, ariaPressed, tone, disabled }: any) {
  const palette = {
    primary: { bg: 'var(--v3-primary-soft)', border: 'color-mix(in srgb, var(--v3-primary) 45%, transparent)', color: 'var(--v3-primary)' },
    danger:  { bg: 'rgba(192, 57, 43, 0.10)', border: 'color-mix(in srgb, var(--v3-danger) 35%, transparent)', color: 'var(--v3-danger-bright)' }
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
        width: 40, height: 40, borderRadius: 12,
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
   ActionTile — Call / Text / Email / Map quick-action button.
   Plain <a> + setTimeout fallback for iOS Safari (audit-batch-6 pattern).
   ============================================================ */

function ActionTile({ icon: Icon, label, href, external }: any) {
  const enabled = !!href
  const baseStyle: import('react').CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    padding: '10px 4px',
    borderRadius: 12,
    background: enabled ? 'var(--v3-surface-2)' : 'rgba(255, 255, 255, 0.02)',
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
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>
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
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>
    </a>
  )
}

/* ============================================================
   CockpitMetric — eyebrow + StampNumber column. Mirrors the
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
   OverviewRead — Contact Info card + Map block (metrics now
   live in the cockpit header above)
   ============================================================ */

function OverviewRead({ client, lifetime, outstanding, activeCount, jobs = [], payments = [], onJump }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 0 24px' }}>

      {/* PIPELINE DISTRIBUTION — counts + value per stage, jumps to Projects */}
      {jobs.length > 0 && (
        <PipelineDistribution jobs={jobs} payments={payments} onJump={onJump} />
      )}

      {/* CONTACT INFO CARD — phone / email / address as separate rows */}
      <div style={{
        padding: '6px 0',
        borderRadius: 16,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.2)',
        overflow: 'hidden'
      }}>
        <div style={{ padding: '14px 18px 8px' }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--v3-text-muted)'
          }}>
            Contact info
          </span>
        </div>
        <ContactRow icon={Phone} label="Phone" value={fmtPhone(client.phone)} href={client.phone ? `tel:${client.phone}` : null} />
        <ContactRow icon={Mail} label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : null} />
        <ContactRow icon={MapPin} label="Address" value={client.address} multiline isLast />
      </div>

      {/* MAP BLOCK — only render when address present */}
      {client.address && (
        <div style={{
          borderRadius: 16,
          overflow: 'hidden',
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border-strong)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.2)'
        }}>
          <a
            href={`https://maps.apple.com/?address=${encodeURIComponent(client.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => hapticTap()}
            style={{
              display: 'block',
              position: 'relative',
              height: 160,
              background: `
                linear-gradient(180deg, transparent 0%, transparent 60%, rgba(7, 7, 10, 0.7) 100%),
                repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.02) 0 16px, transparent 16px 32px),
                repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.02) 0 16px, transparent 16px 32px),
                var(--v3-surface-2)
              `,
              color: 'var(--v3-text)',
              textDecoration: 'none',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {/* Center pin */}
            <div style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--v3-primary)',
                display: 'grid', placeItems: 'center',
                color: 'var(--v3-on-primary)',
                boxShadow: '0 8px 24px rgba(212, 175, 55, 0.45)'
              }}>
                <MapPin size={20} aria-hidden="true" />
              </div>
              <div aria-hidden="true" style={{
                width: 8, height: 8,
                background: 'var(--v3-primary)',
                clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
                marginTop: -2
              }} />
            </div>

            {/* Bottom address strip */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 12
            }}>
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--v3-text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {client.address}
              </span>
              <span style={{
                flexShrink: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.14em', textTransform: 'uppercase',
                color: 'var(--v3-primary)'
              }}>
                Open in Maps →
              </span>
            </div>
          </a>
        </div>
      )}

      {/* OPTIONAL — internal notes from the client record */}
      {client.notes && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 14,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border-strong)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.2)'
        }}>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--v3-text-muted)',
            marginBottom: 8
          }}>
            Internal Notes
          </div>
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
      gap: 14,
      padding: '14px 18px',
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
        background: hasValue ? 'var(--v3-primary-soft)' : 'rgba(255, 255, 255, 0.04)',
        border: hasValue
          ? '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)'
          : '1px solid var(--v3-border)',
        color: hasValue ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
        display: 'grid', placeItems: 'center'
      }}>
        <Icon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--v3-text-muted)',
          marginBottom: 4
        }}>
          {label}
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
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
   OverviewEdit — controlled form, v3 surface
   ============================================================ */

function OverviewEdit({ client, onCommit, onCancel }: any) {
  const [form, setForm] = useState({ ...client })
  const [saving, setSaving] = useState(false)
  function set(k: any, v: any) { setForm((f: any) => ({ ...f, [k]: v })) }
  const fieldStyle: import('react').CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 14px', borderRadius: 12,
    background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
    fontSize: 14, outline: 'none'
  }
  const labelStyle: import('react').CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'var(--v3-text-muted)'
  }
  async function commit() {
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
      padding: 18,
      borderRadius: 16,
      background: 'var(--v3-surface)',
      border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 12px rgba(0, 0, 0, 0.25)',
      display: 'flex', flexDirection: 'column', gap: 12,
      margin: '12px 0 24px'
    }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Name</span>
        <input style={fieldStyle} value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Company</span>
        <input style={fieldStyle} value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Phone</span>
          <input type="tel" inputMode="tel" style={fieldStyle} value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Email</span>
          <input type="email" inputMode="email" style={fieldStyle} value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Address</span>
        <textarea rows={2} style={{ ...fieldStyle, resize: 'vertical' }} value={form.address || ''} onChange={(e) => set('address', e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Notes</span>
        <textarea rows={4} style={{ ...fieldStyle, resize: 'vertical' }} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 10, marginTop: 4 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={{
          padding: '12px 14px', borderRadius: 12,
          background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
          color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
          fontSize: 13, fontWeight: 700, cursor: 'pointer'
        }}>
          Cancel
        </button>
        <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={commit} disabled={saving} style={{
          padding: '12px 14px', borderRadius: 12, border: 'none',
          background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
          letterSpacing: '0.04em',
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
   PipelineDistribution — overview mini-card. Counts + value per
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
    <section style={{
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border-strong)',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.2)'
    }}>
      <header style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, padding: '14px 18px 8px'
      }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)'
        }}>
          Pipeline
        </span>
        {totalRevenue > 0 && (
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--v3-success-bright, #4ade80)'
          }}>
            {money(totalRevenue)} collected
          </span>
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
                  padding: '11px 18px',
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
                  width: 8, height: 8, borderRadius: '50%',
                  background: c, boxShadow: `0 0 10px ${c}66`
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 13, fontWeight: 600,
                    color: 'var(--v3-text)', lineHeight: 1.2
                  }}>
                    {r.label}
                  </div>
                  <div style={{
                    marginTop: 4,
                    height: 4, borderRadius: 999,
                    background: 'rgba(255,255,255,0.05)',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${Math.max(pct, 4)}%`,
                      height: '100%',
                      background: c,
                      borderRadius: 999
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
                    fontSize: 10, fontWeight: 600,
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
   ProjectsList — jobs linked to this client, with stage filter
   chips + per-row paid/balance bar + relative-time stamp.
   ============================================================ */

const PROJECT_FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'active', label: 'Active', match: (j: any) => ['lead', 'quote', 'job', 'invoice'].includes(j.stage as string) },
  { id: 'won',    label: 'Complete', match: (j: any) => j.stage === 'closed' },
  { id: 'lost',   label: 'Lost',   match: (j: any) => j.stage === 'lost' }
]

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

function ProjectsList({ jobs, payments = [], onOpen }: any) {
  const [filter, setFilter] = useState('all')

  const paidByJob = useMemo(() => {
    const m = new Map()
    for (const p of payments || []) {
      if (!p.contact_id) continue
      m.set(p.contact_id, (m.get(p.contact_id) || 0) + Number(p.amount || 0))
    }
    return m
  }, [payments])

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs
    const cfg = PROJECT_FILTERS.find((f) => f.id === filter)
    return cfg ? jobs.filter(cfg.match) : jobs
  }, [jobs, filter])

  if (jobs.length === 0) {
    return <EmptyCard label="No projects linked to this client yet." />
  }

  return (
    <div style={{ padding: '12px 0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Filter chips — dispatch-state pill pattern */}
      <div role="tablist" aria-label="Project filter" style={{
        display: 'flex', gap: 6, padding: 3,
        borderRadius: 999,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)'
      }}>
        {PROJECT_FILTERS.map((f) => {
          const active = filter === f.id
          const count = f.id === 'all' ? jobs.length : jobs.filter(f.match).length
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => { hapticTap(); setFilter(f.id) }}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 999,
                border: 'none',
                background: active ? 'var(--v3-primary)' : 'transparent',
                color: active ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 11, fontWeight: 700,
                letterSpacing: '0.10em', textTransform: 'uppercase',
                fontVariantNumeric: 'tabular-nums',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                transition: 'background 0.15s, color 0.15s'
              }}
            >
              {f.label} <span style={{ opacity: 0.65, fontWeight: 600 }}>{count}</span>
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <EmptyCard label="No projects in this filter." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((j: any) => {
            const c = stageColor(j.stage)
            const amount = Number(j.amount || 0)
            const paid = paidByJob.get(j.id) || 0
            const billable = j.stage === 'job' || j.stage === 'invoice' || j.stage === 'closed'
            const balance = Math.max(0, amount - paid)
            const pct = amount > 0 ? Math.min(100, Math.round((paid / amount) * 100)) : 0
            const stamp = relTime(j.updated_at)
            return (
              <li key={j.id}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.99 }}
                  whileHover={{ y: -2, backgroundColor: 'var(--v3-surface-3)' }}
                  transition={{ type: 'spring', stiffness: 620, damping: 28 }}
                  onClick={() => { hapticTap(); onOpen(j.id) }}
                  style={{
                    width: '100%',
                    position: 'relative',
                    display: 'flex', flexDirection: 'column', gap: 10,
                    padding: '14px 14px 14px 20px',
                    borderRadius: 14,
                    background: '#171511',
                    border: '1px solid var(--v3-border-strong)',
                    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.22)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'var(--v3-text)',
                    overflow: 'hidden',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <span aria-hidden="true" style={{
                    position: 'absolute',
                    left: 0, top: 12, bottom: 12,
                    width: 3,
                    borderRadius: '0 3px 3px 0',
                    background: c,
                    boxShadow: `0 0 12px ${c}66`
                  }} />

                  {/* Row 1 — title + amount */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 14, fontWeight: 700,
                        letterSpacing: '-0.005em',
                        color: 'var(--v3-text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {j.name || 'Untitled'}
                      </div>
                      <div style={{
                        marginTop: 3,
                        fontFamily: 'var(--font-body)',
                        fontSize: 11,
                        color: 'var(--v3-text-muted)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {j.job_title || j.job_type || '—'}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 16,
                        color: 'var(--v3-primary)',
                        letterSpacing: '0.02em',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1
                      }}>
                        {money(amount)}
                      </div>
                      <div style={{
                        marginTop: 4,
                        fontFamily: 'var(--font-body)',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.16em', textTransform: 'uppercase',
                        color: c
                      }}>
                        {j.stage}
                      </div>
                    </div>
                  </div>

                  {/* Row 2 — paid bar (only when there's money to track) */}
                  {amount > 0 && billable && (
                    <div>
                      <div style={{
                        height: 4, borderRadius: 999,
                        background: 'rgba(255,255,255,0.05)',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: pct >= 100 ? 'var(--v3-success-bright, #4ade80)' : c,
                          borderRadius: 999
                        }} />
                      </div>
                      <div style={{
                        marginTop: 6,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8,
                        fontFamily: 'var(--font-body)',
                        fontSize: 10, fontWeight: 600,
                        letterSpacing: '0.06em',
                        color: 'var(--v3-text-muted)',
                        fontVariantNumeric: 'tabular-nums'
                      }}>
                        <span>
                          {money(paid)} paid{paid > 0 ? ` · ${pct}%` : ''}
                        </span>
                        <span style={{ color: balance > 0 ? 'var(--v3-danger-bright, #f5a294)' : 'var(--v3-success-bright, #4ade80)' }}>
                          {balance > 0 ? `${money(balance)} due` : 'Paid in full'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Row 3 — last-touch stamp */}
                  {stamp && (
                    <div style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 10, fontWeight: 600,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: 'var(--v3-text-faint, var(--v3-text-muted))',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      Updated {stamp} ago
                    </div>
                  )}
                </motion.button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ============================================================
   NotesList — communication log across all the client's jobs
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
              padding: '14px 14px 14px 20px',
              borderRadius: 14,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border-strong)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.22)',
              overflow: 'hidden'
            }}>
              <span aria-hidden="true" style={{
                position: 'absolute',
                left: 0, top: 12, bottom: 12,
                width: 3,
                borderRadius: '0 3px 3px 0',
                background: 'var(--v3-primary)',
                boxShadow: '0 0 12px rgba(212, 175, 55, 0.45)'
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <h4 style={{
                  margin: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 14, fontWeight: 700,
                  color: 'var(--v3-text)',
                  letterSpacing: '-0.005em',
                  overflowWrap: 'anywhere'
                }}>
                  {title}
                </h4>
                <span style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 10,
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
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  marginTop: 8,
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'var(--v3-primary-soft)',
                  border: '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)',
                  color: 'var(--v3-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase'
                }}>
                  <Briefcase size={10} />
                  {n.fh_contacts.name}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ============================================================
   FilesList — files + photos across the client's jobs
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
      toast({ kind: 'error', title: 'Could not open', body: error?.message || 'Try again' } as any)
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  return (
    <div style={{ padding: '12px 0 24px' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r: any) => (
          <li key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-border-strong)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.22)'
          }}>
            <span aria-hidden="true" style={{
              flexShrink: 0,
              width: 34, height: 34, borderRadius: 9,
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
              color: 'var(--v3-primary)',
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
                fontSize: 13, fontWeight: 700,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {r.filename}
              </div>
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--font-body)',
                fontSize: 11,
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
