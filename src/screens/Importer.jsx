import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Check, Zap, Copy, FileSpreadsheet, ChevronDown, Eye, EyeOff, Sparkles } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { supabase } from '../lib/supabase.js'
import { claudeMessage } from '../lib/anthropic.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { toastSuccess, toastError } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'

// Importable target fields, in display order. Used by the mapping
// review UI + the AI mapper prompt.
const TARGET_FIELDS = [
  { key: 'name',      label: 'Name',      required: true },
  { key: 'phone',     label: 'Phone' },
  { key: 'email',     label: 'Email' },
  { key: 'address',   label: 'Address' },
  { key: 'job_title', label: 'Job title' },
  { key: 'job_type',  label: 'Job type' },
  { key: 'amount',    label: 'Amount' }
]

// Normalize a column header so "First Name" / "first_name" / "firstname" all match.
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '') }

// Each field has a list of common synonyms. Matching is normalized (case + punct + whitespace agnostic).
const FIELD_SYNONYMS = {
  name:      ['name', 'fullname', 'clientname', 'contact', 'contactname', 'customername', 'firstname', 'company', 'companyname', 'businessname', 'first', 'lead'],
  phone:     ['phone', 'phonenumber', 'mobile', 'mobilephone', 'primaryphone', 'cell', 'cellphone', 'workphone', 'telephone', 'tel'],
  email:     ['email', 'emailaddress', 'primaryemail', 'workemail', 'contactemail', 'mail'],
  address:   ['address', 'street', 'streetaddress', 'street1', 'addressline1', 'propertyaddress', 'serviceaddress', 'location', 'address1'],
  job_title: ['jobname', 'jobtitle', 'title', 'dealname', 'opportunity', 'opportunityname', 'project', 'projectname'],
  job_type:  ['service', 'category', 'servicetype', 'jobtype', 'dealstage', 'stage', 'type', 'trade'],
  amount:    ['total', 'amount', 'quotetotal', 'dealamount', 'value', 'price', 'revenue', 'estimate', 'bidamount']
}

const PRESETS = {
  jobber:  { label: 'Jobber'      },
  hubspot: { label: 'HubSpot'     },
  generic: { label: 'Generic CSV' }
}

// Build a lookup once per parse: for each CSV header we see, resolve which field it maps to (if any).
function buildHeaderMap(headers) {
  const out = {}
  for (const h of headers) {
    const n = norm(h)
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
      if (syns.includes(n)) { out[field] = h; break }
    }
    // Fallback: startsWith / contains match for loose cases.
    if (!Object.values(out).includes(h)) {
      for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
        if (out[field]) continue
        if (syns.some((s) => n.startsWith(s) || n.includes(s))) { out[field] = h; break }
      }
    }
  }
  return out
}

function pick(row, header) {
  if (!header) return null
  const v = row[header]
  return v != null && v !== '' ? v : null
}

export default function Importer() {
  const { user } = useAuth()
  const [preset, setPreset] = useState('jobber')
  const [rows, setRows] = useState([])
  const [mapped, setMapped] = useState([])
  const [headerMap, setHeaderMap] = useState({})
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(null)
  // Raw CSV headers + AI mapping state. headerMap holds the active
  // field→column resolution; the AI mapper and the manual dropdowns
  // both write into it via applyHeaderMap so the preview re-derives.
  const [csvHeaders, setCsvHeaders] = useState([])
  const [aiMapping, setAiMapping] = useState(false)
  const [webhookKey, setWebhookKey] = useState('')
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  // Audit caught the full webhook key rendered in plain text. Default
  // to masked; user reveals on demand.
  const [webhookRevealed, setWebhookRevealed] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('webhook_key').eq('user_id', user.id).single().then(({ data }) => {
      setWebhookKey(data?.webhook_key || '')
    })
  }, [user])

  async function ensureWebhookKey() {
    if (webhookKey) return webhookKey
    const k = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    await supabase.from('profiles').update({ webhook_key: k }).eq('user_id', user.id)
    setWebhookKey(k)
    return k
  }

  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        setRows(r.data)
        remap(r.data, preset)
      }
    })
  }

  function remap(data, p) {
    // Build a header map based on what's actually in the CSV (first row's keys).
    const headers = data[0] ? Object.keys(data[0]) : []
    setCsvHeaders(headers)
    const hm = buildHeaderMap(headers)
    applyHeaderMap(hm, data)
  }

  // Re-derive the mapped preview rows from a given field→column map.
  // Shared by remap (static), the AI mapper, and the manual dropdowns.
  function applyHeaderMap(hm, data = rows) {
    setHeaderMap(hm)
    const out = data.map((r) => ({
      name: pick(r, hm.name),
      phone: pick(r, hm.phone),
      email: pick(r, hm.email),
      address: pick(r, hm.address),
      job_title: pick(r, hm.job_title),
      job_type: pick(r, hm.job_type),
      amount: Number(pick(r, hm.amount) || 0),
      stage: 'lead'
    })).filter((r) => r.name)
    setMapped(out)
  }

  // Manual override from the mapping review dropdowns.
  function setFieldColumn(field, column) {
    const next = { ...headerMap }
    if (column) next[field] = column
    else delete next[field]
    applyHeaderMap(next)
  }

  // AI column mapping — for CSVs whose headers the static synonym
  // matcher can't resolve (QuickBooks, ServiceTitan, custom exports).
  // Sends the headers + 3 sample rows to Claude and asks for a
  // field→header JSON map. Merges over the existing map so already-
  // resolved columns are preserved.
  async function aiMap() {
    if (!csvHeaders.length || aiMapping) return
    setAiMapping(true)
    hapticMedium()
    try {
      const sample = rows.slice(0, 3)
      const system = `You map spreadsheet columns to a fixed set of CRM fields for a contractor's job/lead import. The target fields are: ${TARGET_FIELDS.map((f) => f.key).join(', ')}. Given the CSV headers and a few sample rows, return ONLY a JSON object whose keys are the target field names and whose values are the EXACT matching CSV header string (or null if no column fits). Map "name" to whichever column best identifies the customer or company. Map "amount" to the column holding the dollar value of the job/deal. Never invent headers — values must be exact strings from the provided header list or null. Return ONLY the JSON object, no prose.`
      const userContent = `CSV headers: ${JSON.stringify(csvHeaders)}\n\nSample rows:\n${JSON.stringify(sample, null, 2)}`
      const res = await claudeMessage({
        system,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: 500
      })
      const text = res?.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('AI returned no mapping')
      const parsed = JSON.parse(match[0])
      // Keep only values that are real headers; merge over current map.
      const next = { ...headerMap }
      for (const f of TARGET_FIELDS) {
        const col = parsed[f.key]
        if (col && csvHeaders.includes(col)) next[f.key] = col
      }
      applyHeaderMap(next)
      hapticSuccess()
      const mappedCount = TARGET_FIELDS.filter((f) => next[f.key]).length
      toastSuccess('AI mapped your columns', `${mappedCount} of ${TARGET_FIELDS.length} fields matched`)
    } catch (e) {
      toastError("Couldn't auto-map", e?.message || 'Try the manual mapping below.')
    } finally {
      setAiMapping(false)
    }
  }

  function changePreset(p) {
    setPreset(p)
    if (rows.length) remap(rows, p)
  }

  async function doImport() {
    if (!user || mapped.length === 0) return
    setImporting(true)
    setProgress(10)
    const payload = mapped.map((m) => ({ ...m, user_id: user.id }))
    // Cosmetic progress ramp while the single insert runs. Supabase returns
    // atomically for a batch insert; there's no native per-row progress.
    const tick = setInterval(() => setProgress((p) => (p < 85 ? p + 6 : p)), 120)
    const { error, count } = await supabase.from('fh_contacts').insert(payload, { count: 'exact' })
    clearInterval(tick)
    setProgress(100)
    setTimeout(() => setProgress(0), 400)
    setImporting(false)
    const finalCount = count ?? payload.length
    if (!error) hapticSuccess(); setDone(error ? { err: error.message } : { count: finalCount })
    if (!error) {
      setRows([])
      setMapped([])
      setCsvHeaders([])
      setHeaderMap({})
      toastSuccess(`Imported ${finalCount} contacts`, 'Now in your Pipeline')
    }
  }

  async function copyWebhook() {
    const url = `${origin}/api/webhook-lead?key=${webhookKey}`
    await navigator.clipboard.writeText(url)
    setCopiedWebhook(true)
    setTimeout(() => setCopiedWebhook(false), 1600)
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            Import
          </span>
          <h1 style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 600, color: 'var(--ink-strong)' }}>
            Import your{' '}
            data.
          </h1>
        </div>
        <div
          aria-hidden="true"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 14, border: '1px solid rgba(201,150,58,0.3)', background: 'rgba(201,150,58,0.1)', display: 'grid', placeItems: 'center', color: 'var(--field-gold-bright)' }}
        >
          <FileSpreadsheet size={20} />
        </div>
      </motion.div>

      {/* CSV UPLOAD SECTION */}
      <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
        <header style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
            CSV upload
          </span>
        </header>

        {/* Preset selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {Object.keys(PRESETS).map((p) => {
            const on = p === preset
            return (
              <button
                key={p}
                type="button"
                onClick={() => changePreset(p)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: on ? '1px solid rgba(201,150,58,0.4)' : '1px solid var(--rule)',
                  background: on ? 'rgba(201,150,58,0.14)' : 'var(--surface-2)',
                  color: on ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 160ms ease'
                }}
              >
                {PRESETS[p].label}
              </button>
            )
          })}
        </div>

        {/* Drop zone */}
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: '32px 20px',
            borderRadius: 18,
            border: '2px dashed rgba(201,150,58,0.4)',
            background: 'linear-gradient(135deg, rgba(201,150,58,0.06), rgba(201,150,58,0.02))',
            color: 'var(--ink-strong)',
            cursor: 'pointer',
            textAlign: 'center'
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(201,150,58,0.15)', border: '1px solid rgba(201,150,58,0.35)', display: 'grid', placeItems: 'center', color: 'var(--field-gold-bright)' }}>
            <Upload size={22} />
          </div>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
            {rows.length ? `${rows.length} rows loaded — mapped ${mapped.length}` : 'Drop CSV or tap to pick'}
          </span>
          {!rows.length && (
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
              Columns auto-detected from your {PRESETS[preset].label} export
            </span>
          )}
          <input type="file" accept=".csv" onChange={onFile} hidden />
        </label>

        {/* Column mapping review — only once a file is loaded. Shows the
            resolved field→column map with manual override dropdowns, plus
            an AI auto-map button for headers the static matcher missed. */}
        {csvHeaders.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                Column mapping
              </span>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={aiMap}
                disabled={aiMapping}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 999,
                  border: '1px solid rgba(201,150,58,0.4)',
                  background: 'rgba(201,150,58,0.14)',
                  color: 'var(--field-gold-bright)',
                  fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: aiMapping ? 'wait' : 'pointer',
                  opacity: aiMapping ? 0.7 : 1
                }}
              >
                <Sparkles size={12} />
                {aiMapping ? 'Mapping…' : 'Smart map with AI'}
              </motion.button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TARGET_FIELDS.map((f) => {
                const col = headerMap[f.key] || ''
                const unmapped = !col
                return (
                  <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                      color: unmapped && f.required ? 'var(--alert-red)' : 'var(--ink-strong)'
                    }}>
                      {f.label}{f.required ? ' *' : ''}
                    </span>
                    <select
                      value={col}
                      onChange={(e) => setFieldColumn(f.key, e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '8px 10px', borderRadius: 10,
                        background: 'var(--surface-2)',
                        border: `1px solid ${unmapped && f.required ? 'rgba(192,57,43,0.4)' : 'var(--rule)'}`,
                        color: unmapped ? 'var(--ink-muted)' : 'var(--ink-strong)',
                        fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">— not mapped —</option>
                      {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Preview + import */}
        {mapped.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              Preview (first 5)
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {mapped.slice(0, 5).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                      {m.job_title || '—'} · {m.phone || m.email || 'no contact'}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em', color: 'var(--field-gold-bright)' }}>
                    ${m.amount || 0}
                  </div>
                </div>
              ))}
            </div>
            {importing && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                  <span>Inserting…</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{progress}%</span>
                </div>
                <Progress value={progress} className="ui:h-1.5 ui:bg-white/[0.06]" />
              </div>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={doImport}
              disabled={importing}
              style={{
                marginTop: 14,
                width: '100%',
                padding: '12px 18px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                letterSpacing: '0.14em',
                cursor: importing ? 'default' : 'pointer',
                boxShadow: '0 8px 20px rgba(201,150,58,0.35)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: importing ? 0.65 : 1
              }}
            >
              <Upload size={16} />
              {importing ? 'IMPORTING…' : `IMPORT ${mapped.length} CONTACTS`}
            </motion.button>
          </div>
        )}

        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                marginTop: 12,
                padding: '10px 14px',
                borderRadius: 12,
                background: done.err ? 'rgba(192,57,43,0.12)' : 'rgba(45,122,79,0.14)',
                border: done.err ? '1px solid rgba(192,57,43,0.35)' : '1px solid rgba(45,122,79,0.35)',
                color: done.err ? 'var(--alert-red)' : 'var(--signal-green)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              {done.err || `Imported ${done.count} contacts`}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* LEAD INTAKE LINK — operator-facing reframe of the webhook flow.
          Collapsed by default. Copy stays in business language; the
          example payload is labelled "Example lead details" so it
          reads as guidance, not a JSON spec. */}
      <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
        <details style={{ borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', overflow: 'hidden' }}>
          <summary
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              cursor: 'pointer',
              listStyle: 'none',
              userSelect: 'none'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Zap size={14} color="var(--field-gold-bright)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-strong)' }}>
                Lead intake link
              </span>
            </span>
            <ChevronDown size={16} color="var(--ink-muted)" className="fh-importer-chev" />
          </summary>

          <div style={{ padding: '4px 14px 16px', borderTop: '1px solid var(--rule)' }}>
            <p style={{ margin: '12px 0 10px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              Use this link to send new leads into FieldHorse from your automations — GoHighLevel, Zapier, Make, your website form, anything that can call a URL. Each lead lands straight in your Pipeline.
            </p>
            {webhookKey ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                <code style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {origin}/api/webhook-lead?key={webhookRevealed
                    ? webhookKey
                    : `${'•'.repeat(Math.max(0, webhookKey.length - 5))}${webhookKey.slice(-5)}`}
                </code>
                <button
                  type="button"
                  onClick={() => setWebhookRevealed((v) => !v)}
                  aria-label={webhookRevealed ? 'Hide intake key' : 'Reveal intake key'}
                  style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                >
                  {webhookRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  onClick={copyWebhook}
                  aria-label="Copy intake link"
                  style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: copiedWebhook ? 'var(--signal-green)' : 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                >
                  {copiedWebhook ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            ) : (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={ensureWebhookKey}
                style={{
                  padding: '10px 16px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                  color: 'var(--onyx)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 14,
                  letterSpacing: '0.12em',
                  cursor: 'pointer',
                  boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <Zap size={14} />
                Generate intake link
              </motion.button>
            )}

            <p style={{
              margin: '14px 0 6px',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--ink-muted)',
              fontFamily: 'var(--font-body)'
            }}>
              What to send
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--ink-strong)' }}>Required:</strong> name. <strong style={{ color: 'var(--ink-strong)' }}>Optional:</strong> phone, email, address, job title, amount, notes.
            </p>

            <p style={{
              margin: '0 0 6px',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
              textTransform: 'uppercase', color: 'var(--ink-muted)',
              fontFamily: 'var(--font-body)'
            }}>
              Example lead details
            </p>
            <pre
              style={{
                margin: 0,
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--surface-2)',
                border: '1px solid var(--rule)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--ink-muted)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap'
              }}
            >{`{
  "name": "Jane Homeowner",
  "phone": "555-0199",
  "email": "jane@homeowner.com",
  "address": "123 Elm St",
  "job_title": "Kitchen remodel",
  "amount": 42000,
  "notes": "Heard about us from Houzz"
}`}</pre>
          </div>
        </details>
      </motion.section>
    </motion.div>
  )
}
