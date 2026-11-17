import { createUuid } from '../lib/uuid.ts'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
// @ts-ignore -- papaparse ships no types
import Papa from 'papaparse'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Check, Zap, Copy, FileSpreadsheet, ChevronDown, Eye, EyeOff, Sparkles } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { supabase } from '../lib/supabase.ts'
import { claudeMessage } from '../lib/anthropic.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticMedium, hapticSuccess } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { Eyebrow } from '../components/v3'
import { countNoun, moneyCents } from '../lib/format.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import BuildTopbar from '../components/desktop/BuildTopbar.tsx'
import MiniMetric from '../components/MiniMetric.tsx'
import { Button } from '../ui/index.ts'
import { leadKeys, markRepeats } from '../lib/importDedupe.ts'
import { fetchAllRows } from '../lib/queries.ts'
import { useMembership } from '../contexts/MembershipContext.tsx'
import {
  TARGET_FIELDS, PRESETS, buildHeaderMap, mapRows, markFileRepeats, looksLikeCsv, hasNameSource,
  type HeaderMap, type ImportField, type ImportRecord
} from '../lib/importMapping.ts'
import { runImport } from '../lib/importRun.ts'

export default function Importer() {
  const isDesktop = useIsDesktop()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const [preset, setPreset] = useState('jobber')
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [mapped, setMapped] = useState<ImportRecord[]>([])
  const [headerMap, setHeaderMap] = useState<HeaderMap>({})
  // Rows left out for having no name, and a plain note about the file
  // when it cannot be read or nothing in it maps.
  const [skipped, setSkipped] = useState(0)
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState<any>(null)
  // Raw CSV headers + AI mapping state. headerMap holds the active
  // field→column resolution; the AI mapper and the manual dropdowns
  // both write into it via applyHeaderMap so the preview re-derives.
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [aiMapping, setAiMapping] = useState(false)
  const [webhookKey, setWebhookKey] = useState('')
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  // Audit caught the full webhook key rendered in plain text. Default
  // to masked; user reveals on demand.
  const [webhookRevealed, setWebhookRevealed] = useState(false)
  // Dedupe keys for leads already on file (null until loaded) and the
  // operator's choice to import matching rows anyway.
  const [existingKeys, setExistingKeys] = useState<Set<string> | null>(null)
  const [includeRepeats, setIncludeRepeats] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase.from('profiles').select('webhook_key').eq('user_id', user!.id).single().then(({ data }: any) => {
      setWebhookKey(data?.webhook_key || '')
    })
  }, [user])

  // Once a file is loaded, read the leads already on file (every fh_leads
  // row RLS lets this user see, with the client each one points at) so
  // re-running an export skips them instead of doubling the pipeline. A
  // failed read falls back to no repeat check rather than blocking the import.
  useEffect(() => {
    if (!user || rows.length === 0 || existingKeys) return
    let cancelled = false
    type ExistingLead = { title: string | null; fh_clients: { name: string | null; phone: string | null; email: string | null } | null }
    fetchAllRows<ExistingLead>((from, to) =>
      supabase
        .from('fh_leads')
        .select('id, title, fh_clients!fh_leads_client_id_fkey(name, phone, email)')
        .order('id', { ascending: true })
        .range(from, to)
    )
      .then((existing) => {
        if (cancelled) return
        const identities = existing.map((l) => ({
          name: l.fh_clients?.name ?? null,
          phone: l.fh_clients?.phone ?? null,
          email: l.fh_clients?.email ?? null,
          job_title: l.title
        }))
        setExistingKeys(new Set(identities.flatMap(leadKeys)))
      })
      .catch((e) => {
        console.warn('[importer] repeat check unavailable', e)
        if (!cancelled) setExistingKeys(new Set())
      })
    return () => { cancelled = true }
  }, [user, rows.length, existingKeys])

  const checkingRepeats = rows.length > 0 && existingKeys == null
  const repeatFlags = useMemo(
    () => (existingKeys ? markRepeats(mapped, existingKeys) : mapped.map(() => false)),
    [mapped, existingKeys]
  )
  // A row that repeats an earlier row in the same file is never imported
  // twice; the pipeline check counts only the rows left.
  const fileRepeatFlags = useMemo(() => markFileRepeats(mapped), [mapped])
  const fileRepeatCount = fileRepeatFlags.filter(Boolean).length
  const repeatCount = repeatFlags.filter((r, i) => r && !fileRepeatFlags[i]).length
  const toImport = mapped.filter((_, i) => !fileRepeatFlags[i] && (includeRepeats || !repeatFlags[i]))

  async function ensureWebhookKey() {
    if (webhookKey) return webhookKey
    const k = createUuid().replace(/-/g, '').slice(0, 24)
    await supabase.from('profiles').update({ webhook_key: k }).eq('user_id', user!.id)
    setWebhookKey(k)
    return k
  }

  function clearFile() {
    setRows([])
    setMapped([])
    setCsvHeaders([])
    setHeaderMap({})
    setSkipped(0)
  }

  // Shared by the file picker and drag and drop.
  function loadFile(f: File | null | undefined) {
    if (!f) return
    setDone(null)
    setIncludeRepeats(false)
    if (!looksLikeCsv(f)) {
      clearFile()
      setFileNote(`${f.name} is not a CSV file. Export your data as CSV and choose that file.`)
      return
    }
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (r: { data: Record<string, unknown>[]; meta?: { fields?: string[] } }) => {
        const headers = r.meta?.fields?.length ? r.meta.fields : r.data[0] ? Object.keys(r.data[0]) : []
        if (r.data.length === 0) {
          clearFile()
          setFileNote(headers.length ? 'This file has column names but no rows to import.' : 'This file is empty.')
          return
        }
        const hm = buildHeaderMap(headers, preset)
        if (Object.keys(hm).length === 0) {
          clearFile()
          setFileNote('None of the columns in this file look like a name, phone, email or job. Check that the first row holds the column names.')
          return
        }
        setFileNote(null)
        setRows(r.data)
        setCsvHeaders(headers)
        applyHeaderMap(hm, r.data)
      }
    })
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    loadFile(e.target.files?.[0])
    // Choosing the same file again should load it again.
    e.target.value = ''
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    loadFile(e.dataTransfer.files?.[0])
  }

  function remap(data: Record<string, unknown>[], p: string) {
    applyHeaderMap(buildHeaderMap(csvHeaders, p), data)
  }

  // Re-derive the mapped preview rows from a given field to column map.
  // Shared by remap, the AI mapper, and the manual dropdowns.
  function applyHeaderMap(hm: HeaderMap, data = rows) {
    setHeaderMap(hm)
    const { records, skipped: noName } = mapRows(data, hm)
    setMapped(records)
    setSkipped(noName)
  }

  // Manual override from the mapping review dropdowns.
  function setFieldColumn(field: ImportField, column: string) {
    const next = { ...headerMap }
    if (column) next[field] = column
    else delete next[field]
    applyHeaderMap(next)
  }

  // AI column mapping, for CSVs whose headers the static synonym
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
      const system = `You map spreadsheet columns to a fixed set of CRM fields for a contractor's job/lead import. The target fields are: ${TARGET_FIELDS.map((f) => f.key).join(', ')}. Given the CSV headers and a few sample rows, return ONLY a JSON object whose keys are the target field names and whose values are the EXACT matching CSV header string (or null if no column fits). Map "name" to a column holding the customer's full name. When names are split, map "first_name" and "last_name" instead and leave "name" null. Map "company" to the company or business name column. Map "amount" to the column holding the dollar value of the job/deal. Never invent headers, values must be exact strings from the provided header list or null. Return ONLY the JSON object, no prose.`
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
      const next: HeaderMap = { ...headerMap }
      for (const f of TARGET_FIELDS) {
        const col = parsed[f.key]
        if (col && csvHeaders.includes(col)) next[f.key] = col
      }
      applyHeaderMap(next)
      hapticSuccess()
      const mappedCount = TARGET_FIELDS.filter((f) => next[f.key]).length
      toastSuccess(
        'AI mapped your columns',
        `${mappedCount} of ${TARGET_FIELDS.length} ${countNoun(TARGET_FIELDS.length, 'field')} matched`
      )
    } catch (e: any) {
      toastError("Couldn't map automatically", e?.message || 'Try the manual mapping below.')
    } finally {
      setAiMapping(false)
    }
  }

  function changePreset(p: string) {
    setPreset(p)
    if (rows.length) remap(rows, p)
  }

  async function doImport() {
    if (!user || toImport.length === 0 || checkingRepeats) return
    setImporting(true)
    setProgress(5)
    const payload = toImport
    const { landed, count: finalCount, error } = await runImport({
      userId: user.id,
      orgId,
      records: payload,
      onProgress: setProgress
    })
    // Rows that landed are now on file: a retry or a second file in this
    // session must treat them as repeats.
    if (landed > 0) {
      setExistingKeys((prev) => {
        const next = new Set(prev || [])
        for (const row of payload.slice(0, landed)) for (const k of leadKeys(row)) next.add(k)
        return next
      })
    }
    setProgress(100)
    setTimeout(() => setProgress(0), 400)
    setImporting(false)
    if (error) {
      // Failure path previously only set the red banner, no toast, no
      // haptic, and the one-liner `if (!error) hapticSuccess(); setDone(...)`
      // read like the haptic was conditional on the whole line. Split
      // for symmetry with the success path.
      const msg = landed > 0
        ? `Imported ${landed} of ${payload.length}. The rest did not import: ${error.message}`
        : error.message
      // The rows that landed now read as repeats; skip them on a retry.
      setIncludeRepeats(false)
      setDone({ err: msg })
      toastError("Import failed", msg)
      return
    }
    hapticSuccess()
    setDone({ count: finalCount })
    clearFile()
    setIncludeRepeats(false)
    toastSuccess(`Imported ${finalCount} ${countNoun(finalCount, 'contact')}`, 'Open Jobs, then Leads to review imported records.')
  }

  async function copyWebhook() {
    const url = `${origin}/api/webhook-lead?key=${webhookKey}`
    await navigator.clipboard.writeText(url)
    setCopiedWebhook(true)
    setTimeout(() => setCopiedWebhook(false), 1600)
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const { stagger, item } = useFhMotion()
  const mappedFieldCount = TARGET_FIELDS.filter((field) => headerMap[field.key]).length

  return (
    <motion.div
      className={isDesktop ? 'fh-build-page fh-importer-build' : 'fh-screen'}
      data-build-screen={isDesktop ? 'Importer' : undefined}
      data-build-route={isDesktop ? '/import' : undefined}
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 48, position: 'relative' }}
    >
      {isDesktop && (
        <BuildTopbar
          searchPlaceholder="Search jobs, clients, invoices, notes..."
          meta={[
            rows.length ? `${rows.length} ${countNoun(rows.length, 'row')} loaded` : 'No file loaded',
            `${mappedFieldCount} of ${TARGET_FIELDS.length} fields mapped`,
          ]}
        />
      )}

      <div className={isDesktop ? 'fh-importer-build__main' : undefined}>
      {/* HEADER */}
      {!isDesktop && <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '24px 24px 12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Eyebrow>
            Import
          </Eyebrow>
          <h1 style={{ margin: '4px 0 0', fontSize: 24, lineHeight: 1.1, letterSpacing: 0, fontWeight: 600, color: 'var(--ink-strong)' }}>
            Import your{' '}
            data.
          </h1>
        </div>
        <div
          aria-hidden="true"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 10, border: '1px solid rgba(201,150,58,0.3)', background: 'rgba(201,150,58,0.1)', display: 'grid', placeItems: 'center', color: 'var(--v3-primary-text)' }}
        >
          <FileSpreadsheet size={20} />
        </div>
      </motion.div>}

      {isDesktop && (
        <motion.section variants={item} className="fh-build-hero-row fh-build-hero-row--page fh-importer-build__hero">
          <div>
            <div className="fh-build-good">Office</div>
            <h1 className="fh-build-title">Import data.</h1>
          </div>
          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Import readiness</div>
            <p>
              {rows.length
                ? `${mapped.length} ${countNoun(mapped.length, 'record')} ready for review.`
                : `Choose a ${PRESETS[preset].label} export or a generic CSV.`}
            </p>
            <Link className="fh-importer-build__focus-meta" to="/jobs?stage=leads">Destination · Jobs / Leads</Link>
          </div>
          <div className="fh-build-mini-grid">
            <MiniMetric label="Rows loaded" value={String(rows.length)} accent={rows.length > 0} />
            <MiniMetric label="Mapped fields" value={`${mappedFieldCount}/${TARGET_FIELDS.length}`} />
            <MiniMetric label="Ready records" value={String(mapped.length)} />
            <MiniMetric label="Source" value={PRESETS[preset].label} />
          </div>
        </motion.section>
      )}

      {/* CSV UPLOAD SECTION */}
      <motion.section variants={item} className="v3-section fh-importer-build__upload" style={{ margin: '0 var(--v3-gutter) 14px' }}>
        <header style={{ marginBottom: 10 }}>
          <Eyebrow style={{ color: 'var(--ink-muted)' }}>
            CSV upload
          </Eyebrow>
        </header>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-muted)' }}>
          Upload a CSV, review column mapping and preview records before importing. Imported records appear in Jobs under Leads.
          {' '}<Link to="/jobs?stage=leads" style={{ color: 'var(--v3-primary-text)', textDecoration: 'underline' }}>Open lead workspace</Link>
        </p>

        {/* Preset selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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
                  color: on ? 'var(--v3-primary-text)' : 'var(--ink-muted)',
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '32px 24px',
            borderRadius: 10,
            border: '2px dashed rgba(201,150,58,0.4)',
            background: 'linear-gradient(135deg, rgba(201,150,58,0.06), rgba(201,150,58,0.02))',
            color: 'var(--ink-strong)',
            cursor: 'pointer',
            textAlign: 'center'
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 10, background: 'rgba(201,150,58,0.15)', border: '1px solid rgba(201,150,58,0.35)', display: 'grid', placeItems: 'center', color: 'var(--v3-primary-text)' }}>
            <Upload size={22} />
          </div>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--ink-strong)' }}>
            {rows.length
              ? `${rows.length} ${countNoun(rows.length, 'row')} loaded, ${mapped.length} ${countNoun(mapped.length, 'record')} ready`
              : isDesktop ? 'Drop CSV or choose a file' : 'Choose a CSV file'}
          </span>
          {!rows.length && (
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Columns detected automatically from your {PRESETS[preset].label} export
            </span>
          )}
          <input type="file" accept=".csv,text/csv" onChange={onFile} hidden />
        </label>

        {fileNote && (
          <p role="alert" style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--v3-danger-text)' }}>
            {fileNote}
          </p>
        )}
        {csvHeaders.length > 0 && !hasNameSource(headerMap) && (
          <p role="alert" style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--v3-danger-text)' }}>
            No column in this file looks like a customer name. Pick the name column below.
          </p>
        )}
        {(skipped > 0 || fileRepeatCount > 0) && (
          <p style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
            {skipped > 0 && `${skipped} ${countNoun(skipped, 'row')} ${skipped === 1 ? 'has' : 'have'} no name and will be skipped. `}
            {fileRepeatCount > 0 && `${fileRepeatCount} ${countNoun(fileRepeatCount, 'row')} ${fileRepeatCount === 1 ? 'repeats' : 'repeat'} an earlier row in this file and will be skipped.`}
          </p>
        )}

        {/* Column mapping review, only once a file is loaded. Shows the
            resolved field→column map with manual override dropdowns, plus
            an AI map automatically button for headers the static matcher missed. */}
        {csvHeaders.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <Eyebrow style={{ color: 'var(--ink-muted)' }}>
                Column mapping
              </Eyebrow>
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={aiMap}
                disabled={aiMapping}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 10,
                  border: '1px solid rgba(201,150,58,0.4)',
                  background: 'rgba(201,150,58,0.14)',
                  color: 'var(--field-gold-bright)',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                  letterSpacing: 0,
                  cursor: aiMapping ? 'wait' : 'pointer',
                  opacity: aiMapping ? 0.7 : 1
                }}
              >
                <Sparkles size={12} />
                {aiMapping ? 'Mapping…' : 'Smart map with AI'}
              </motion.button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TARGET_FIELDS.map((f) => {
                const col = headerMap[f.key] || ''
                const unmapped = !col
                return (
                  <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                      color: unmapped && f.required ? 'var(--v3-danger-text)' : 'var(--ink-strong)'
                    }}>
                      {f.label}{f.required ? ' *' : ''}
                    </span>
                    <select
                      value={col}
                      onChange={(e) => setFieldColumn(f.key, e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '8px 12px', borderRadius: 10,
                        background: 'var(--surface-2)',
                        border: `1px solid ${unmapped && f.required ? 'rgba(192,57,43,0.4)' : 'var(--rule)'}`,
                        color: unmapped ? 'var(--ink-muted)' : 'var(--ink-strong)',
                        fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">Not mapped</option>
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
            <Eyebrow style={{ color: 'var(--ink-muted)' }}>
              Preview (first 5)
            </Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {mapped.slice(0, 5).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: fileRepeatFlags[i] || (repeatFlags[i] && !includeRepeats) ? 0.55 : 1 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                      {m.job_title || '\u2003'} · {m.phone || m.email || 'no contact'}
                      {fileRepeatFlags[i] ? ' · repeats an earlier row' : repeatFlags[i] ? ' · already in pipeline' : ''}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 0, color: 'var(--field-gold-bright)' }}>
                    {m.amount ? moneyCents(m.amount) : ''}
                  </div>
                </div>
              ))}
            </div>
            {checkingRepeats && (
              <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
                Checking your pipeline for leads you already have…
              </div>
            )}
            {repeatCount > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
                <span>
                  {repeatCount} {countNoun(repeatCount, 'row')} {repeatCount === 1 ? 'matches a lead' : 'match leads'} already in your pipeline and will be {includeRepeats ? 'imported again' : 'skipped'}.
                </span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ink-strong)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeRepeats}
                    disabled={importing}
                    onChange={(e) => setIncludeRepeats(e.target.checked)}
                  />
                  Import them anyway
                </label>
              </div>
            )}
            {importing && (
              <div style={{ marginTop: 14 }}>
                <Eyebrow as="div" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: 'var(--ink-muted)' }}>
                  <span>Inserting…</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{progress}%</span>
                </Eyebrow>
                <Progress value={progress} className="ui:h-1.5 ui:bg-white/[0.06]" />
              </div>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={doImport}
              disabled={importing || checkingRepeats || toImport.length === 0}
              style={{
                marginTop: 14,
                width: '100%',
                padding: '12px 16px',
                borderRadius: 10,
                border: 'none',
                background: importing || checkingRepeats || toImport.length === 0 ? 'var(--fh-tray)' : 'var(--fh-gold)',
                minHeight: 44,
                color: importing || checkingRepeats || toImport.length === 0 ? 'var(--fh-ink-2)' : 'var(--fh-on-gold)',
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                letterSpacing: 0,
                cursor: importing || checkingRepeats || toImport.length === 0 ? 'default' : 'pointer',
                boxShadow: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: 1
              }}
            >
              <Upload size={16} />
              {importing ? 'Importing…' : `Import ${toImport.length} ${countNoun(toImport.length, 'contact')}`}
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
                padding: '12px 12px',
                borderRadius: 10,
                background: done.err ? 'rgba(192,57,43,0.12)' : 'rgba(45,122,79,0.14)',
                border: done.err ? '1px solid rgba(192,57,43,0.35)' : '1px solid rgba(45,122,79,0.35)',
                color: done.err ? 'var(--v3-danger-text)' : 'var(--v3-success-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                fontWeight: 600
              }}
            >
              {done.err || `Imported ${done.count} ${countNoun(done.count, 'contact')}`}
              <div style={{ marginTop: 12 }}>
                <Link to="/jobs?stage=leads" className="fh-build-secondary-btn" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>View imported leads</Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* LEAD INTAKE LINK, operator-facing reframe of the webhook flow.
          Collapsed by default. Copy stays in business language; the
          example payload is labelled "Example lead details" so it
          reads as guidance, not a JSON spec. */}
      <motion.section variants={item} className="v3-section fh-importer-build__intake" style={{ margin: '0 var(--v3-gutter) 14px' }}>
        <details style={{ borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', overflow: 'hidden' }}>
          <summary
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 12px',
              cursor: 'pointer',
              listStyle: 'none',
              userSelect: 'none'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Zap size={14} color="var(--field-gold-bright)" />
              <Eyebrow style={{ color: 'var(--ink-strong)' }}>
                Automation and developer setup
              </Eyebrow>
            </span>
            <ChevronDown size={16} color="var(--ink-muted)" className="fh-importer-chev" />
          </summary>

          <div style={{ padding: '4px 12px 16px', borderTop: '1px solid var(--rule)' }}>
            <p style={{ margin: '12px 0 10px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              Send new leads from GoHighLevel, Zapier, Make or a website form. Each lead appears in Jobs under Leads, linked to its customer.
              {' '}<Link to="/jobs?stage=leads">Open lead workspace</Link>
            </p>
            {webhookKey ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                <code style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {origin}/api/webhook-lead?key={webhookRevealed
                    ? webhookKey
                    : `${'•'.repeat(Math.max(0, webhookKey.length - 5))}${webhookKey.slice(-5)}`}
                </code>
                <button
                  type="button"
                  onClick={() => setWebhookRevealed((v) => !v)}
                  aria-label={webhookRevealed ? 'Hide intake key' : 'Reveal intake key'}
                  style={{ width: 30, height: 30, borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                >
                  {webhookRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  onClick={copyWebhook}
                  aria-label="Copy intake link"
                  style={{ width: 30, height: 30, borderRadius: 10, border: 'none', background: 'transparent', color: copiedWebhook ? 'var(--v3-success-text)' : 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                >
                  {copiedWebhook ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            ) : (
              <Button
                type="button"
                onClick={ensureWebhookKey}
                size="md"
                leftIcon={Zap}
              >
                Generate intake link
              </Button>
            )}

            <Eyebrow as="p" style={{ display: 'flex', margin: '16px 0 8px', color: 'var(--ink-muted)' }}>
              What to send
            </Eyebrow>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--ink-strong)' }}>Required:</strong> name. <strong style={{ color: 'var(--ink-strong)' }}>Optional:</strong> phone, email, address, job title, amount, notes.
            </p>

            <Eyebrow as="p" style={{ display: 'flex', margin: '0 0 8px', color: 'var(--ink-muted)' }}>
              Example lead details
            </Eyebrow>
            <pre
              style={{
                margin: 0,
                padding: '12px 12px',
                borderRadius: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--rule)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
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
      </div>
    </motion.div>
  )
}
