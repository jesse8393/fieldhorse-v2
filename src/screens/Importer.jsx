import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Check, Zap, Copy, FileSpreadsheet, ChevronDown } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { toastSuccess } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'

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
  const [webhookKey, setWebhookKey] = useState('')
  const [copiedWebhook, setCopiedWebhook] = useState(false)

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
    const hm = buildHeaderMap(headers)
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
      toastSuccess(`Imported ${finalCount} contacts`, 'Now in your pipeline')
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
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Bring it{' '}
            all in.
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
      <motion.section variants={item} style={{ padding: '0 20px 18px' }}>
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
                  background: on ? 'rgba(201,150,58,0.14)' : 'rgba(255,255,255,0.04)',
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

        {/* Preview + import */}
        {mapped.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              Preview (first 5)
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {mapped.slice(0, 5).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
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

      {/* ADVANCED INTEGRATIONS — collapsed by default so contractors aren't
          greeted with dev-speak. Webhook endpoint + POST JSON shape live here. */}
      <motion.section variants={item} style={{ padding: '0 20px 24px' }}>
        <details style={{ borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', overflow: 'hidden' }}>
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
                Advanced integrations
              </span>
            </span>
            <ChevronDown size={16} color="var(--ink-muted)" className="fh-importer-chev" />
          </summary>

          <div style={{ padding: '4px 14px 16px', borderTop: '1px solid var(--rule)' }}>
            <p style={{ margin: '12px 0 10px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              Send leads from GoHighLevel, Zapier, Make, or any tool that can POST JSON. The endpoint routes new leads straight into your pipeline.
            </p>
            {webhookKey ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
                <code style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {origin}/api/webhook-lead?key={webhookKey}
                </code>
                <button
                  type="button"
                  onClick={copyWebhook}
                  aria-label="Copy webhook URL"
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
                GENERATE WEBHOOK KEY
              </motion.button>
            )}
            <pre
              style={{
                marginTop: 10,
                padding: '12px 14px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--rule)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--ink-muted)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap'
              }}
            >{`POST JSON shape:
{
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
