import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const PRESETS = {
  jobber: {
    label: 'Jobber',
    map: {
      name: ['Client Name', 'Name', 'Client'],
      phone: ['Mobile Phone', 'Phone', 'Primary Phone'],
      email: ['Email', 'Primary Email'],
      address: ['Street 1', 'Address', 'Property Address'],
      job_title: ['Job Name', 'Title'],
      job_type: ['Service', 'Category'],
      amount: ['Total', 'Quote Total', 'Amount']
    }
  },
  hubspot: {
    label: 'HubSpot',
    map: {
      name: ['First Name', 'Company', 'Contact Name'],
      phone: ['Phone Number', 'Mobile'],
      email: ['Email'],
      address: ['Street Address'],
      job_title: ['Deal Name'],
      job_type: ['Deal Stage'],
      amount: ['Deal Amount']
    }
  },
  generic: {
    label: 'Generic CSV',
    map: {
      name: ['name', 'Name', 'Full Name', 'Contact'],
      phone: ['phone', 'Phone'],
      email: ['email', 'Email'],
      address: ['address', 'Address'],
      job_title: ['title', 'Job', 'Job Title'],
      job_type: ['type', 'Category'],
      amount: ['amount', 'Total', 'Value']
    }
  }
}

function pick(row, keys) {
  for (const k of keys) if (row[k] != null && row[k] !== '') return row[k]
  return null
}

export default function Importer() {
  const { user } = useAuth()
  const [preset, setPreset] = useState('jobber')
  const [rows, setRows] = useState([])
  const [mapped, setMapped] = useState([])
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(null)
  const [webhookKey, setWebhookKey] = useState('')

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
    const map = PRESETS[p].map
    const out = data.map((r) => ({
      name: pick(r, map.name),
      phone: pick(r, map.phone),
      email: pick(r, map.email),
      address: pick(r, map.address),
      job_title: pick(r, map.job_title),
      job_type: pick(r, map.job_type),
      amount: Number(pick(r, map.amount) || 0),
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
    const payload = mapped.map((m) => ({ ...m, user_id: user.id }))
    const { error, count } = await supabase.from('fh_contacts').insert(payload, { count: 'exact' })
    setImporting(false)
    setDone(error ? { err: error.message } : { count: count ?? payload.length })
    if (!error) { setRows([]); setMapped([]) }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__num">§ 01</span>
            <span className="fh-sec-tag__label">Bring your book of business</span>
          </span>
          <h1 className="fh-page__title">Import</h1>
        </div>
      </header>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">CSV upload</span>
        </div>
        <div className="fh-import">
          <div className="fh-seg">
            {Object.keys(PRESETS).map((p) => (
              <button key={p} type="button" className={p === preset ? 'is-on' : ''} onClick={() => changePreset(p)}>
                {PRESETS[p].label}
              </button>
            ))}
          </div>
          <label className="fh-import__drop">
            <Icon name="upload" size={32} />
            <span>{rows.length ? `${rows.length} rows loaded — mapped ${mapped.length}` : 'Drop CSV or tap to pick'}</span>
            <input type="file" accept=".csv" onChange={onFile} hidden />
          </label>
          {mapped.length > 0 && (
            <div className="fh-import__preview">
              <span className="fh-eye">Preview (first 5)</span>
              <div className="fh-rows">
                {mapped.slice(0, 5).map((m, i) => (
                  <div key={i} className="fh-row">
                    <div style={{ flex: 1 }}>
                      <div className="fh-row__k">{m.name}</div>
                      <div className="fh-row__sub">{m.job_title || '—'} · {m.phone || m.email || 'no contact'}</div>
                    </div>
                    <div className="fh-row__v">${m.amount || 0}</div>
                  </div>
                ))}
              </div>
              <button type="button" className="fh-btn fh-btn--gold" onClick={doImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${mapped.length} contacts`}
              </button>
            </div>
          )}
          <AnimatePresence>
            {done && (
              <motion.div
                className={done.err ? 'fh-err' : 'fh-success'}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {done.err || `Imported ${done.count} contacts`}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="fh-section">
        <div className="fh-section__head">
          <span className="fh-section__title">Webhook endpoint</span>
          <span className="fh-pill">GoHighLevel · Zapier · Make</span>
        </div>
        <div className="fh-webhook">
          <p className="fh-webhook__note">POST lead JSON to this URL and it shows up in your pipeline as a new lead.</p>
          {webhookKey ? (
            <div className="fh-webhook__url">
              <code>{origin}/api/webhook-lead?key={webhookKey}</code>
              <button type="button" className="fh-iconbtn" onClick={() => navigator.clipboard.writeText(`${origin}/api/webhook-lead?key=${webhookKey}`)}>
                <Icon name="check" size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className="fh-btn fh-btn--gold" onClick={ensureWebhookKey}>
              <Icon name="bolt" size={16} />
              Generate webhook key
            </button>
          )}
          <pre className="fh-webhook__sample">{`POST JSON shape:
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
      </section>
    </section>
  )
}
