import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ChevronLeft, Pencil, X as XIcon, Save as SaveIcon, Briefcase, FileText,
  Paperclip, Image as ImageIcon, Download, Phone, Mail, MapPin, Trash2
} from 'lucide-react'
import Aurora from '../components/fx/Aurora.jsx'
import GridPattern from '../components/fx/GridPattern.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'notes', label: 'Notes' },
  { id: 'files', label: 'Files' }
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
        return
      }
      const [{ data: n }, { data: f }] = await Promise.all([
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
          .limit(60)
      ])
      if (cancelled) return
      setNotes(n || [])
      setFiles(f || [])
    }
    loadTabData()
    return () => { cancelled = true }
  }, [client?.id])

  async function patch(update) {
    if (!client?.id) return
    setClient((c) => ({ ...c, ...update }))
    const { error } = await supabase.from('fh_clients').update(update).eq('id', client.id)
    if (!error) toastSuccess('Saved', 'Client updated')
  }

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
      <div className="fh-screen" style={{ paddingBottom: 120, padding: '10px 20px 120px' }}>
        <SkeletonList rows={4} card={false} />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="fh-screen" style={{ padding: '10px 20px 120px' }}>
        <button type="button" onClick={() => navigate('/clients')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, cursor: 'pointer' }}>← Back to clients</button>
        <p style={{ color: 'var(--ink-muted)', marginTop: 12 }}>Client not found.</p>
      </div>
    )
  }

  return (
    <motion.div
      className="fh-screen"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ paddingBottom: 120, position: 'relative' }}
    >
      {/* HERO */}
      <div style={{ position: 'relative', padding: '10px 20px 16px', overflow: 'hidden' }}>
        <Aurora />
        <GridPattern />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <button
            type="button"
            onClick={() => navigate('/clients')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 0', background: 'transparent', border: 'none', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            <ChevronLeft size={14} />
            Clients
          </button>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
                Client
              </span>
              <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(24px, 7vw, 34px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
                <em className="fh-font-serif-italic fh-text-gradient-gold" style={{ fontStyle: 'italic' }}>
                  {client.name}.
                </em>
              </h1>
              {client.company_name && (
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
                  {client.company_name}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
            <KpiPill label="Lifetime" value={money(client.total_lifetime_value)} gold />
            <KpiPill label="Active jobs" value={String(client.active_jobs_count)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => setIsEditing((v) => !v)}
              aria-pressed={isEditing}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '11px 14px',
                borderRadius: 12,
                background: isEditing ? 'rgba(201,150,58,0.18)' : 'rgba(255,255,255,0.04)',
                border: isEditing ? '1px solid rgba(201,150,58,0.5)' : '1px solid var(--rule)',
                color: isEditing ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                letterSpacing: '0.14em',
                cursor: 'pointer'
              }}
            >
              <Pencil size={14} />
              {isEditing ? 'EDITING' : 'EDIT'}
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={handleDelete}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '11px 14px',
                borderRadius: 12,
                background: 'rgba(192,57,43,0.10)',
                border: '1px solid rgba(192,57,43,0.35)',
                color: 'var(--alert-red)',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                letterSpacing: '0.14em',
                cursor: 'pointer'
              }}
            >
              <Trash2 size={14} />
              DELETE
            </motion.button>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="fh-tabs-wrap" style={{ padding: '6px 20px 12px' }}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            aria-label="Client tabs"
            className="ui:flex ui:w-full ui:gap-1 ui:overflow-x-auto ui:bg-white/[0.03] ui:border ui:border-border ui:rounded-xl ui:p-1"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="ui:flex-shrink-0 ui:px-3 ui:py-1.5 ui:rounded-lg ui:text-xs ui:font-bold ui:uppercase ui:tracking-wider ui:text-muted-foreground ui:data-[state=active]:bg-white/[0.08] ui:data-[state=active]:text-foreground"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div style={{ padding: '0 20px' }}>
        {tab === 'overview' && (
          isEditing
            ? <OverviewEdit client={client} onCommit={async (patch) => { await supabase.from('fh_clients').update(patch).eq('id', client.id); await fetchClient(); setIsEditing(false) }} onCancel={() => setIsEditing(false)} />
            : <OverviewRead client={client} />
        )}
        {tab === 'jobs' && <JobsList jobs={jobs} onOpen={(jobId) => navigate(`/jobs/${jobId}`)} />}
        {tab === 'notes' && <NotesList notes={notes} onOpen={() => navigate('/notes')} />}
        {tab === 'files' && <FilesList rows={files} />}
      </div>
    </motion.div>
  )
}

function KpiPill({ label, value, gold }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '12px 14px',
        borderRadius: 14,
        background: gold ? 'linear-gradient(135deg, rgba(30,20,10,0.9), rgba(20,15,10,0.6))' : 'rgba(255,255,255,0.03)',
        border: gold ? '1px solid rgba(201,150,58,0.35)' : '1px solid var(--rule)'
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{label}</div>
      <div
        className={gold ? 'fh-text-gradient-gold' : undefined}
        style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: '0.01em', lineHeight: 1, marginTop: 8, color: gold ? undefined : 'var(--ink-strong)' }}
      >
        {value}
      </div>
    </div>
  )
}

function OverviewRead({ client }) {
  const rows = [
    { label: 'Name', value: client.name },
    { label: 'Company', value: client.company_name },
    { label: 'Phone', value: client.phone, icon: Phone },
    { label: 'Email', value: client.email, icon: Mail },
    { label: 'Address', value: client.address, icon: MapPin },
    { label: 'Notes', value: client.notes, multiline: true }
  ]
  return (
    <div style={{ padding: '4px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: r.multiline ? 'block' : 'grid',
            gridTemplateColumns: r.multiline ? undefined : '110px 1fr',
            gap: r.multiline ? 4 : 12,
            alignItems: 'baseline',
            padding: '12px 0',
            borderBottom: i < rows.length - 1 ? '1px solid rgba(201,150,58,0.08)' : 'none'
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{r.label}</span>
          {r.value
            ? <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-strong)', wordBreak: 'break-word', whiteSpace: r.multiline ? 'pre-wrap' : 'normal' }}>{r.value}</span>
            : <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-faint)', fontStyle: 'italic' }}>Not set</span>
          }
        </div>
      ))}
    </div>
  )
}

function OverviewEdit({ client, onCommit, onCancel }) {
  const [form, setForm] = useState({ ...client })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }
  const fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }
  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }
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
    <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <XIcon size={14} />
          Cancel
        </button>
        <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={commit} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em', cursor: saving ? 'default' : 'pointer', boxShadow: '0 6px 16px rgba(201,150,58,0.3)', opacity: saving ? 0.6 : 1 }}>
          <SaveIcon size={14} />
          {saving ? 'SAVING…' : 'SAVE'}
        </motion.button>
      </div>
    </div>
  )
}

function JobsList({ jobs, onOpen }) {
  if (jobs.length === 0) {
    return <EmptyCard label="No jobs linked to this client yet." />
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {jobs.map((j) => {
        const c = stageColor(j.stage)
        return (
          <li key={j.id}>
            <button
              type="button"
              onClick={() => onOpen(j.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 12px 20px', borderRadius: 12, background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))', border: '1px solid var(--rule)', textAlign: 'left', cursor: 'pointer', color: 'var(--ink-strong)', position: 'relative', overflow: 'hidden' }}
            >
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: c, boxShadow: `0 0 10px ${c}66` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {j.name || 'Untitled'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {j.job_title || j.job_type || '—'}
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--field-gold-bright)', letterSpacing: '0.02em' }}>{money(j.amount)}</div>
                <div style={{ marginTop: 2, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: c, fontWeight: 700 }}>{j.stage}</div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function NotesList({ notes }) {
  if (notes.length === 0) return <EmptyCard label="No notes on this client's jobs." />
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {notes.map((n) => {
        const body = n.text || n.body || ''
        const title = n.parsed?.summary || (body.split('\n').find((l) => l.trim()) || '').slice(0, 80) || 'Untitled'
        return (
          <li key={n.id} style={{ position: 'relative', overflow: 'hidden', padding: '12px 14px 12px 20px', borderRadius: 12, background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))', border: '1px solid var(--rule)' }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: 'linear-gradient(180deg, var(--field-gold-bright), var(--field-gold-deep))' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <h4 style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-strong)', overflowWrap: 'anywhere' }}>
                {title}
              </h4>
              <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}>
                {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
            {body && body !== title && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', whiteSpace: 'pre-wrap' }}>{body}</p>
            )}
            {n.fh_contacts?.name && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, padding: '2px 8px', borderRadius: 999, background: 'rgba(201,150,58,0.1)', border: '1px solid rgba(201,150,58,0.28)', color: 'var(--field-gold-bright)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                <Briefcase size={10} />
                {n.fh_contacts.name}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

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
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
          <span aria-hidden="true" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', display: 'grid', placeItems: 'center' }}>
            {r.kind === 'photo' ? <ImageIcon size={14} /> : <Paperclip size={14} />}
          </span>
          <button type="button" onClick={() => open(r)} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--ink-strong)' }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.filename}</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)' }}>
              {fmtSize(r.size_bytes)} · {r.fh_contacts?.name || 'job'} · {new Date(r.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </div>
          </button>
          <button type="button" onClick={() => open(r)} aria-label="Open" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Download size={14} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function EmptyCard({ label }) {
  return (
    <div style={{ padding: '24px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
      {label}
    </div>
  )
}
