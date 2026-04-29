import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ChevronLeft, Pencil, X as XIcon, Save as SaveIcon,
  Briefcase, Paperclip, Image as ImageIcon, Download,
  Phone, Mail, MapPin, Trash2, MessageSquare, Users
} from 'lucide-react'
import { hapticTap, hapticMedium, hapticError } from '../lib/haptics.js'
import { SkeletonList } from '../components/Skeleton.jsx'
import { SegmentedTabs } from '../components/v3'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { toast, toastSuccess, toastInfo } from '../lib/toast.js'
import { stageColor } from '../lib/stages.js'

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function fmtPhone(n) {
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

  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [isEditing, setIsEditing] = useState(false)
  const [jobs, setJobs] = useState([])
  const [notes, setNotes] = useState([])
  const [files, setFiles] = useState([])
  const [payments, setPayments] = useState([])

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
    () => (jobs || []).filter((j) => ['lead', 'quote', 'job', 'invoice'].includes(j.stage)).length,
    [jobs]
  )

  const fetchClient = useCallback(async () => {
    if (!user || !id) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_clients')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    setClient(data || null)
    setLoading(false)
  }, [user, id])

  useEffect(() => { fetchClient() }, [fetchClient])

  useEffect(() => {
    if (!client?.id) return
    let cancelled = false
    async function loadTabData() {
      const { data: j } = await supabase
        .from('fh_contacts')
        .select('id, name, stage, job_title, job_type, amount, updated_at')
        .eq('client_id', client.id)
        .order('updated_at', { ascending: false })
      if (cancelled) return
      setJobs(j || [])
      const jobIds = (j || []).map((r) => r.id)
      if (jobIds.length === 0) {
        setNotes([])
        setFiles([])
        setPayments([])
        return
      }
      const [{ data: n }, { data: f }, { data: p }] = await Promise.all([
        supabase
          .from('fh_notes')
          .select('*, fh_contacts(name)')
          .in('contact_id', jobIds)
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('fh_job_files')
          .select('*, fh_contacts(name)')
          .in('job_id', jobIds)
          .order('uploaded_at', { ascending: false })
          .limit(60),
        supabase
          .from('fh_payments')
          .select('contact_id, amount')
          .in('contact_id', jobIds)
      ])
      if (cancelled) return
      setNotes(n || [])
      setFiles(f || [])
      setPayments(p || [])
    }
    loadTabData()
    return () => { cancelled = true }
  }, [client?.id])

  async function handleDelete() {
    if (!client?.id) return
    if (!window.confirm(`Delete ${client.name}? Jobs keep running (they just lose the client link).`)) return
    const { error } = await supabase.from('fh_clients').delete().eq('id', client.id)
    if (error) {
      toast({ kind: 'error', title: "Couldn't delete", body: error.message })
      return
    }
    toastInfo('Client deleted', 'Linked jobs unlinked')
    navigate('/clients')
  }

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

  return (
    <motion.div
      className="v3-screen"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >

      {/* TOP BAR — back chevron + edit + delete in the chrome row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px 8px' }}>
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
          <IconBtn onClick={() => { hapticError(); handleDelete() }} ariaLabel="Delete client" tone="danger">
            <Trash2 size={16} />
          </IconBtn>
        </div>
      </div>

      {/* HERO — large avatar + name + active badge + company */}
      <div style={{ padding: '0 var(--v3-gutter) 16px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div aria-hidden="true" style={{
          flexShrink: 0,
          width: 76, height: 76,
          borderRadius: 22,
          background: 'linear-gradient(135deg, var(--v3-primary-soft), rgba(212, 175, 55, 0.04))',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 34,
          letterSpacing: '0.04em',
          color: 'var(--v3-primary)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(212, 175, 55, 0.16)'
        }}>
          {initial}
        </div>
        <div style={{ minWidth: 0, flex: 1, paddingTop: 4 }}>
          <h1 style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontSize: 'clamp(24px, 6vw, 32px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            fontWeight: 400,
            color: 'var(--v3-text)'
          }}>
            {client.name}
          </h1>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {activeCount > 0 ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 999,
                background: 'var(--v3-success-soft)',
                border: '1px solid rgba(79, 140, 94, 0.40)',
                color: 'var(--v3-success-bright)',
                fontFamily: 'var(--font-body)',
                fontSize: 10, fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                fontVariantNumeric: 'tabular-nums'
              }}>
                <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--v3-success-bright)' }} />
                Active · {activeCount}
              </span>
            ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px', borderRadius: 999,
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
                fontSize: 13,
                color: 'var(--v3-text-muted)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {client.company_name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ACTION ROW — Call · Text · Email · Map (4 equal columns) */}
      <div style={{ padding: '0 var(--v3-gutter) 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
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
            ? <OverviewEdit client={client} onCommit={async (patch) => { await supabase.from('fh_clients').update(patch).eq('id', client.id); await fetchClient(); setIsEditing(false) }} onCancel={() => setIsEditing(false)} />
            : <OverviewRead client={client} lifetime={lifetime} outstanding={outstanding} activeCount={activeCount} />
        )}
        {tab === 'projects' && (
          <ProjectsList jobs={jobs} onOpen={(jobId) => navigate(`/jobs/${jobId}`)} />
        )}
        {tab === 'files' && <FilesList rows={files} />}
        {tab === 'notes' && <NotesList notes={notes} />}
      </div>
    </motion.div>
  )
}

/* ============================================================
   IconBtn — chrome icon button (back / edit / more / delete)
   ============================================================ */

function IconBtn({ children, onClick, ariaLabel, ariaPressed, tone, disabled }) {
  const palette = {
    primary: { bg: 'var(--v3-primary-soft)', border: 'color-mix(in srgb, var(--v3-primary) 45%, transparent)', color: 'var(--v3-primary)' },
    danger:  { bg: 'rgba(192, 57, 43, 0.10)', border: 'color-mix(in srgb, var(--v3-danger) 35%, transparent)', color: 'var(--v3-danger-bright)' }
  }
  const p = (tone && palette[tone]) || { bg: 'var(--v3-surface)', border: 'var(--v3-border-strong)', color: 'var(--v3-text)' }
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

function ActionTile({ icon: Icon, label, href, external }) {
  const enabled = !!href
  const baseStyle = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    padding: '14px 4px',
    borderRadius: 14,
    background: enabled ? 'var(--v3-surface)' : 'rgba(255, 255, 255, 0.02)',
    border: `1px solid ${enabled ? 'var(--v3-border-strong)' : 'var(--v3-border)'}`,
    boxShadow: enabled ? 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 1px 2px rgba(0, 0, 0, 0.2)' : 'none',
    color: enabled ? 'var(--v3-text)' : 'var(--v3-text-muted)',
    textDecoration: 'none',
    minHeight: 64,
    opacity: enabled ? 1 : 0.4,
    cursor: enabled ? 'pointer' : 'default',
    WebkitTapHighlightColor: 'transparent'
  }

  if (!enabled) {
    return (
      <div aria-disabled="true" style={baseStyle}>
        <Icon size={20} aria-hidden="true" />
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
   OverviewRead — Contact Info card + Map block + Financial Summary
   ============================================================ */

function OverviewRead({ client, lifetime, outstanding, activeCount }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 0 24px' }}>

      {/* FINANCIAL SUMMARY — large lifetime + outstanding + active */}
      <div style={{
        padding: '20px 20px 18px',
        borderRadius: 18,
        background: `
          radial-gradient(120% 80% at 100% 0%, rgba(212, 175, 55, 0.10), transparent 55%),
          var(--v3-surface)
        `,
        border: '1px solid color-mix(in srgb, var(--v3-primary) 18%, transparent)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 4px 16px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--v3-text-muted)'
          }}>
            Lifetime value
          </span>
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(40px, 10vw, 56px)',
            lineHeight: 1,
            letterSpacing: '0.005em',
            color: 'var(--v3-primary)',
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 2px 18px rgba(212, 175, 55, 0.16)'
          }}>
            {money(lifetime)}
          </span>
        </div>

        {/* Sub-metrics row */}
        <div style={{
          marginTop: 16, paddingTop: 14,
          borderTop: '1px solid var(--v3-border)',
          display: 'flex', alignItems: 'baseline', gap: 22, flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
              color: outstanding > 0 ? 'var(--v3-danger-bright)' : 'var(--v3-text)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {money(outstanding)}
            </span>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--v3-text-muted)'
            }}>
              Outstanding
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
              color: activeCount > 0 ? 'var(--v3-text)' : 'var(--v3-text-muted)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {activeCount}
            </span>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--v3-text-muted)'
            }}>
              {activeCount === 1 ? 'Active job' : 'Active jobs'}
            </span>
          </div>
        </div>
      </div>

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
                radial-gradient(60% 60% at 50% 50%, rgba(212, 175, 55, 0.10), transparent 70%),
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

function ContactRow({ icon: Icon, label, value, href, multiline, isLast }) {
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
          fontStyle: hasValue ? 'normal' : 'italic',
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

function OverviewEdit({ client, onCommit, onCancel }) {
  const [form, setForm] = useState({ ...client })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }
  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 14px', borderRadius: 12,
    background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
    fontSize: 14, outline: 'none'
  }
  const labelStyle = {
    fontFamily: 'var(--font-body)',
    fontSize: 10, fontWeight: 700,
    letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'var(--v3-text-muted)'
  }
  async function commit() {
    const EDITABLE = ['name', 'company_name', 'phone', 'email', 'address', 'notes']
    const patch = {}
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
   ProjectsList — jobs linked to this client
   ============================================================ */

function ProjectsList({ jobs, onOpen }) {
  if (jobs.length === 0) {
    return <EmptyCard label="No projects linked to this client yet." />
  }
  return (
    <div style={{ padding: '12px 0 24px' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {jobs.map((j) => {
          const c = stageColor(j.stage)
          return (
            <li key={j.id}>
              <motion.button
                type="button"
                whileTap={{ scale: 0.99 }}
                whileHover={{ y: -2, backgroundColor: '#2A2620' }}
                transition={{ type: 'spring', stiffness: 620, damping: 28 }}
                onClick={() => { hapticTap(); onOpen(j.id) }}
                style={{
                  width: '100%',
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 12,
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
                    {money(j.amount)}
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
              </motion.button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ============================================================
   NotesList — communication log across all the client's jobs
   ============================================================ */

function NotesList({ notes }) {
  if (notes.length === 0) return <EmptyCard label="No notes on this client's jobs yet." />
  return (
    <div style={{ padding: '12px 0 24px' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.map((n) => {
          const body = n.text || n.body || ''
          const title = n.parsed?.summary || (body.split('\n').find((l) => l.trim()) || '').slice(0, 80) || 'Untitled'
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

function FilesList({ rows }) {
  if (rows.length === 0) return <EmptyCard label="No files or photos across this client's jobs." />
  function fmtSize(n) {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }
  async function open(row) {
    const bucket = row.kind === 'photo' ? 'job-photos' : 'job-files'
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(row.storage_path, 60 * 60)
    if (error || !data?.signedUrl) {
      toast({ kind: 'error', title: 'Could not open', body: error?.message || 'Try again' })
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }
  return (
    <div style={{ padding: '12px 0 24px' }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
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
              width: 32, height: 32, borderRadius: 9,
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

function EmptyCard({ label }) {
  return (
    <div className="v3-empty" style={{ margin: '12px 0 24px' }}>
      {label}
    </div>
  )
}
