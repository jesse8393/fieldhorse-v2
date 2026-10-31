import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Calculator, Sparkles, Copy, Check, FileText, Briefcase, BookmarkPlus, Star, Trash2, X } from 'lucide-react'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import BuildTopbar from '../components/desktop/BuildTopbar.tsx'
import { RATE_CARD, TRADE_LABELS, loadUserRateCard } from '../lib/rateCard.ts'
import { claudeMessage } from '../lib/anthropic.ts'
import { JOB_TYPES } from '../lib/jobTypes.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticMedium, hapticSuccess } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { supabase } from '../lib/supabase.ts'
import { useClientsBundle, useEstimateTemplates, useInvalidateEstimateTemplates } from '../lib/queries.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { createQuote } from '../lib/quotes.ts'
import { recordRoute } from '../lib/records.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import CountUp from '../components/fx/CountUp.tsx'
import SectionHeader from '../components/v3/SectionHeader.tsx'
import { FilterPill, Eyebrow } from '../components/v3'
import { useArmedId } from '../lib/secondTap.ts'
import { parseAmount } from '../lib/amount.ts'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useActiveCompany } from '../lib/queries.ts'
import { onlyActiveCompany } from '../lib/activeCompany.ts'
import { updateProfilePreferences } from '../lib/profilePreferences.ts'
import { changeTemplatePreferences, templatePreferences, type TemplatePreferences } from './estimates/estimateLibrary.ts'
import QuoteLibrary from './estimates/QuoteLibrary.tsx'
import DataErrorState from '../components/DataErrorState.tsx'


// White-label: internal-only tool but no app-attributable phrasing
// just in case any of the output is shown to a customer downstream.
const SYSTEM = `You are an estimating assistant for a contractor's business. Given a scope description, return JSON with: line_items (array of {name, qty, unit, rate_low, rate_high, notes}), total_low, total_high, contingency_pct, assumptions (array), risks (array). Use rates from the provided rate card when possible. Tailor line items to the job_type category provided (new build, renovation, addition, kitchen, bath, concrete, outdoor living, insurance, roofing). Never mention any platform, app, or tool by name in your output. Return ONLY JSON.`

// Trades shown in the chip picker, driven by the seed. The user's
// custom keys still flow through into the prompt + manual-fill rows
// via the merged rate card; we just don't surface them as suggested
// pre-checks because they're user-specific.
const TRADES = Object.keys(RATE_CARD)

// The model is asked for JSON numbers but can answer "12,000" or
// "$4,500", which made totals NaN ("$NaN" headline, null job amount).
// Coerce every money and quantity field once, on the way in. Missing or
// unreadable values become null so the `|| 1` and `??` fallbacks below
// still apply.
function normalizeBid(raw: any) {
  if (!raw || typeof raw !== 'object') return raw
  return {
    ...raw,
    total_low: parseAmount(raw.total_low),
    total_high: parseAmount(raw.total_high),
    line_items: Array.isArray(raw.line_items)
      ? raw.line_items
        .filter((li: any) => li && typeof li === 'object')
        .map((li: any) => ({
          ...li,
          qty: parseAmount(li.qty),
          rate_low: parseAmount(li.rate_low),
          rate_high: parseAmount(li.rate_high)
        }))
      : []
  }
}

function money(n: any) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function formatThousands(n: any) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function capitalize(s: any) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '' }

export default function Bid() {
  const { user } = useAuth()
  const { profile, refresh: refreshProfile } = useProfile()
  const company = useActiveCompany()
  const [searchParams, setSearchParams] = useSearchParams()
  const workspaceView = searchParams.get('view') === 'quotes' ? 'quotes' : searchParams.get('view') === 'templates' ? 'templates' : 'builder'
  function setWorkspaceView(view: string) {
    const next = new URLSearchParams(searchParams)
    next.set('view', view)
    setSearchParams(next, { replace: true })
  }
  const [templateSaving, setTemplateSaving] = useState<string | null>(null)
  const [libraryFilter, setLibraryFilter] = useState('all')
  async function saveTemplatePreference(id: string, patch: Partial<TemplatePreferences>) {
    if (!user?.id || templateSaving) return
    setTemplateSaving(id)
    try {
      await updateProfilePreferences(user.id, current => changeTemplatePreferences(current, id, patch))
      await refreshProfile()
      toastSuccess('Library updated')
    } catch (error) { toastError('Could not update library', error instanceof Error ? error.message : 'Try again.') }
    finally { setTemplateSaving(null) }
  }
  // Deleting a template takes a second tap on the same button (D57).
  const deleteTap = useArmedId()
  const navigate = useNavigate()
  const [scope, setScope] = useState('')
  const [marginPct, setMarginPct] = useState(25)
  const [generating, setGenerating] = useState(false)
  const [bid, setBid] = useState<any>(null)
  const [err, setErr] = useState('')
  const [picks, setPicks] = useState<any[]>([])
  const [jobType, setJobType] = useState('')
  const [copied, setCopied] = useState(false)
  const [pushing, setPushing] = useState(false)
  // The quote the bid becomes needs a client (SPEC D59): typed here, picked
  // from the roster by name, or made in place when the name matches nobody.
  const orgId = useOrgScope(user?.id)
  const { data: clientsBundle } = useClientsBundle(user?.id)
  const clients = clientsBundle?.clients ?? []
  const [clientName, setClientName] = useState('')
  // Templates library (migration 024). Loaded via TanStack Query and
  // invalidated after every save/delete so the picker stays fresh.
  const templateQueryState = useEstimateTemplates(user?.id)
  const templates = useMemo(() => onlyActiveCompany(templateQueryState.data || [], company), [templateQueryState.data, company])
  const fetchTemplates = useInvalidateEstimateTemplates()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [templateQuery, setTemplateQuery] = useState('')
  const [templateType, setTemplateType] = useState('')
  const templateTypes = useMemo(() => Array.from(new Set(templates.map(template => template.job_type || 'Uncategorized'))).sort(), [templates])
  const matchingTemplates = useMemo(() => {
    const needle = templateQuery.trim().toLocaleLowerCase()
    return templates.filter(template => (libraryFilter === 'all' || (libraryFilter === 'favorites' ? templatePreferences(profile?.preferences, template.id).favorite : templatePreferences(profile?.preferences, template.id).category === libraryFilter))
      && (!templateType || (template.job_type || 'Uncategorized') === templateType)
      && (!needle || [template.name, template.description, template.job_type, JSON.stringify(template.line_items)]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)))
      .sort((a, b) => Number(templatePreferences(profile?.preferences, b.id).favorite) - Number(templatePreferences(profile?.preferences, a.id).favorite))
  }, [templates, templateQuery, templateType, libraryFilter, profile?.preferences])
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateNamePrompt, setTemplateNamePrompt] = useState('')
  // Merged rate card (seed defaults + user overrides + custom trades).
  // Falls back to RATE_CARD before load resolves so the screen is
  // usable instantly on first paint.
  const [userRates, setUserRates] = useState(() => {
    const m: Record<string, any> = {}
    for (const [k, v] of Object.entries(RATE_CARD)) m[k] = { ...v, label: TRADE_LABELS[k] || k }
    return m
  })

  // Fetch user rate-card overrides once per session. Falls back silently
  // to the seed defaults on error.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!user?.id) return
      const { merged } = await loadUserRateCard(user.id)
      if (!cancelled) setUserRates(merged)
    })()
    return () => { cancelled = true }
  }, [user?.id])

  const total = useMemo(() => {
    if (!bid) return null
    const low = bid.total_low || bid.line_items?.reduce((s: any, li: any) => s + (li.rate_low * (li.qty || 1)), 0) || 0
    const high = bid.total_high || bid.line_items?.reduce((s: any, li: any) => s + (li.rate_high * (li.qty || 1)), 0) || 0
    const midpoint = (low + high) / 2
    const withMargin = midpoint / (1 - marginPct / 100)
    return { low, high, midpoint, withMargin }
  }, [bid, marginPct])

  async function generate() {
    if (!scope.trim()) return
    setGenerating(true)
    setErr('')
    setBid(null)
    try {
      const rateText = Object.keys(userRates)
        .map((k) => `${k}: $${userRates[k].low} to $${userRates[k].high} per ${userRates[k].unit}`)
        .join('; ')
      const res = await claudeMessage({
        system: `${SYSTEM}\n\nRate card: ${rateText}`,
        messages: [{
          role: 'user',
          content: `Job type: ${jobType || 'unspecified'}\nScope: ${scope}\nPre-checked trades: ${picks.join(', ') || 'none'}`
        }],
        maxTokens: 1400
      })
      const text = res?.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsedBid = normalizeBid(JSON.parse(match[0]))
        hapticSuccess(); setBid(parsedBid)
        const low = parsedBid.total_low || parsedBid.line_items?.reduce((s: any, li: any) => s + (li.rate_low * (li.qty || 1)), 0) || 0
        const high = parsedBid.total_high || parsedBid.line_items?.reduce((s: any, li: any) => s + (li.rate_high * (li.qty || 1)), 0) || 0
        const withMargin = ((low + high) / 2) / (1 - marginPct / 100)
        hapticSuccess(); toastSuccess('Estimate ready', money(Math.round(withMargin)))
      } else {
        setErr('AI returned no structured estimate')
      }
    } catch (e: any) {
      console.error('[bid] generate failed:', e)
      setErr(e.message || 'Estimate generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function togglePick(t: any) {
    setPicks((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])
  }

  // Push the AI bid into a real quote (Phase 9, Task 10, D53): an fh_quotes
  // row for the client named above, with one fh_quote_items row per AI line
  // item carrying quote_id (rate = high end of the range, so the operator
  // can dial back rather than up). Lands on /quotes/:id, ready to refine
  // and send. A name that matches no client makes one in place (D59).
  async function pushToJob() {
    if (!bid || !total || !user?.id || pushing) return
    const name = clientName.trim()
    if (!name) {
      toastError('Name the client first', 'Type who this quote is for. A new name makes a new client.')
      return
    }
    setPushing(true)
    try {
      const recommendedPrice = Math.round(total.withMargin)
      const jobTitle = bid.summary
        || (jobType ? `${capitalize(jobType)} project` : 'New estimate')

      // ONE price everywhere: scale every line rate so the items sum
      // EXACTLY to the recommended price; the last item absorbs the
      // rounding remainder.
      const rawItems = (bid.line_items || []).map((li: any) => ({
        li,
        qty: Number(li.qty || 1),
        rate: Number(li.rate_high ?? li.rate_low ?? 0)
      })).filter((r: any) => r.qty * r.rate > 0)
      const rawSubtotal = rawItems.reduce((s: number, r: any) => s + r.qty * r.rate, 0)
      const scale = rawSubtotal > 0 ? recommendedPrice / rawSubtotal : 1
      let allocated = 0
      const scaledItems = rawItems.map((r: any, idx: number) => {
        const isLast = idx === rawItems.length - 1
        let amount = isLast
          ? recommendedPrice - allocated
          : Math.round(r.qty * r.rate * scale)
        if (amount < 0) amount = 0
        allocated += amount
        const rate = r.qty > 0 ? Math.round((amount / r.qty) * 100) / 100 : amount
        return { ...r, amount, rate }
      })

      // 1. The client: an existing one by name, or a new row.
      let clientId = clients.find((c: any) => String(c.name || '').trim().toLowerCase() === name.toLowerCase())?.id as string | undefined
      if (!clientId) {
        const { data: made, error: clErr } = await supabase
          .from('fh_clients')
          .insert({ user_id: user.id, org_id: orgId || null, name })
          .select('id')
          .single()
        if (clErr) throw clErr
        clientId = (made as { id: string }).id
      }

      // 2. The quote, with the bid's notes as its scope.
      const notes = [
        scope || '',
        bid.assumptions?.length ? `Assumptions:\n${bid.assumptions.map((a: any) => `${a}`).join('\n')}` : '',
        bid.risks?.length ? `Risks:\n${bid.risks.map((r: any) => `${r}`).join('\n')}` : ''
      ].filter(Boolean).join('\n\n')
      const quote = await createQuote({
        userId: user.id,
        orgId: orgId || '',
        clientId,
        title: jobTitle,
        scopeText: notes || null,
        jobType: jobType || null
      })

      // 3. One fh_quote_items row per AI line item, on the quote.
      const items = scaledItems.map((r: any, idx: number) => ({
        user_id: user.id,
        quote_id: quote.id,
        contact_id: null,
        section: TRADE_LABELS[picks[0]] || 'Scope',
        description: r.li.name + (r.li.notes ? ` (${r.li.notes})` : ''),
        qty: r.qty,
        unit: r.li.unit || null,
        rate: r.rate,
        amount: r.amount,
        is_optional: false,
        is_excluded: false,
        sort_order: idx
      })).filter((row: any) => row.rate > 0 || row.amount > 0)

      if (items.length > 0) {
        const { error: iErr } = await supabase.from('fh_quote_items').insert(items)
        if (iErr) throw iErr
      }

      hapticSuccess()
      toastSuccess(
        'Pushed to a new quote',
        `${items.length} line item${items.length === 1 ? '' : 's'} added, ${money(recommendedPrice)}`
      )
      navigate(recordRoute('quote', quote.id))
    } catch (e: any) {
      console.error('[bid] pushToJob failed:', e)
      toastError("Couldn't create the quote from this bid", e?.message || 'Try again.')
    } finally {
      setPushing(false)
    }
  }

  // Save the current bid output as a reusable template. Naming is
  // a quick in-page prompt, the operator types the template name
  // inline and hits save. Cancel resets the prompt without writing.
  async function saveAsTemplate() {
    if (!bid || !total || !user?.id || savingTemplate) return
    const name = (templateNamePrompt || '').trim()
      || bid.summary
      || (jobType ? `${capitalize(jobType)} template` : 'Untitled estimate')
    setSavingTemplate(true)
    try {
      const { error } = await supabase.from('fh_estimate_templates').insert({
        user_id: user.id,
        org_id: orgId,
        name,
        description: bid.summary || null,
        job_type: jobType || null,
        line_items: bid.line_items || [],
        total_low:  bid.total_low ?? null,
        total_high: bid.total_high ?? null
      })
      if (error) throw error
      hapticSuccess()
      toastSuccess('Saved to templates', name)
      setTemplateNamePrompt('')
      await fetchTemplates()
    } catch (e: any) {
      toastError("Couldn't save template", e?.message || 'Try again.')
    } finally {
      setSavingTemplate(false)
    }
  }

  // Load a saved template into the current bid state, skips the AI
  // round trip entirely. The operator can refine + push to a job
  // from there as if they'd just generated it.
  function loadTemplate(t: any) {
    // Templates hold saved model output, so normalize them the same way.
    setBid(normalizeBid({
      summary: t.description || t.name,
      line_items: t.line_items || [],
      total_low:  t.total_low,
      total_high: t.total_high,
      assumptions: [],
      risks: []
    }))
    if (t.job_type) setJobType(t.job_type)
    setScope(`Loaded from template: ${t.name}`)
    setPickerOpen(false)
    setWorkspaceView('builder')
    hapticSuccess()
    toastSuccess('Template loaded', t.name)
  }

  async function deleteTemplate(t: any) {
    if (!t?.id) return
    try {
      const { error } = await supabase.from('fh_estimate_templates').delete().eq('id', t.id)
      if (error) throw error
      toastSuccess('Template deleted', t.name)
      await fetchTemplates()
    } catch (e: any) {
      toastError("Couldn't delete", e?.message || 'Try again.')
    }
  }

  async function copyEstimate() {
    if (!bid || !total) return
    const lines = [
      `${bid.summary || (jobType ? `${jobType} estimate` : 'Estimate')}`,
      '',
      `Recommended price (${marginPct}% margin): ${money(Math.round(total.withMargin))}`,
      `Raw range: ${money(total.low)} to ${money(total.high)}`,
      '',
      'Line items:',
      ...(bid.line_items || []).map((li: any) => `  • ${li.name}${li.notes ? `, ${li.notes}` : ''} (${li.qty || 1} ${li.unit}: ${money((li.rate_low || 0) * (li.qty || 1))} to ${money((li.rate_high || 0) * (li.qty || 1))})`),
      ...(bid.assumptions?.length ? ['', 'Assumptions:', ...bid.assumptions.map((a: any) => `  • ${a}`)] : []),
      ...(bid.risks?.length ? ['', 'Risks:', ...bid.risks.map((r: any) => `  • ${r}`)] : [])
    ]
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    toastSuccess('Estimate copied', 'Ready to paste into a proposal')
  }

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  return (
    <motion.div
      className={`v3-screen${isDesktop ? ' fh-build-utility fh-bid-workspace' : ''}${workspaceView !== 'builder' ? ' fh-bid-workspace--library' : ''}`}
      data-build-screen={isDesktop ? 'Bid' : undefined}
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 48, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {isDesktop && <BuildTopbar />}
      {/* HEADER, working-tool, no serif italic. Dropped per the design
          direction: editorial type belongs on hero/marketing surfaces,
          not on a tool the operator uses to build a bid. Desktop H1
          uses the same Bebas Neue display style as Jobs/Clients/
          Schedule so /bid matches the rest of the command center. */}
      <motion.div
        className="fh-bid-workspace__header"
        variants={item}
        style={{
          padding: '12px var(--v3-gutter) 12px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className={isDesktop ? 'fh-build-good' : undefined} style={isDesktop ? undefined : {
            fontFamily: 'var(--font-body)',
            fontSize: 12, fontWeight: 700,
            letterSpacing: 0,
            color: 'var(--v3-primary-text)',
            display: 'inline-flex', alignItems: 'center', gap: 8
          }}>
            <Calculator size={11} aria-hidden="true" />
            Estimates
          </span>
          <h1 className={isDesktop ? 'fh-build-title' : undefined} style={isDesktop ? undefined : {
            margin: '6px 0 0',
            fontFamily: 'var(--font-body)',
            fontSize: 24,
            lineHeight: 1.2,
            letterSpacing: 0,
            fontWeight: 700,
            color: 'var(--v3-text)'
          }}>
            Estimates
          </h1>
          <p style={{
            margin: '6px 0 0',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--v3-text-muted)'
          }}>
            Manage quotes, reuse templates and build your next estimate.
          </p>
          {workspaceView !== 'quotes' && templateQueryState.isError && <DataErrorState title="Templates unavailable" message="Check your connection and try again." onRetry={() => { void templateQueryState.refetch() }} />}
          <nav aria-label="Estimate workspace" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <Link to="/bid?view=quotes" aria-current={workspaceView === 'quotes' ? 'page' : undefined} className="fh-build-secondary-btn" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>All quotes</Link>
            <Link to="/bid?view=builder" aria-current={workspaceView === 'builder' ? 'page' : undefined} className="fh-build-secondary-btn" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Estimate builder</Link>
            <Link to="/bid?view=templates" aria-current={workspaceView === 'templates' ? 'page' : undefined} className="fh-build-secondary-btn" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Templates</Link>
            {workspaceView !== 'quotes' && <Link to="/quotes/new" className="fh-build-secondary-btn" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>New quote</Link>}
          </nav>
        </div>
      </motion.div>

      {workspaceView === 'quotes' && <QuoteLibrary />}
      {workspaceView === 'templates' && templateQueryState.isPending && <p className="fh-estimate-library" role="status">Loading templates…</p>}
      {workspaceView === 'templates' && !templateQueryState.isPending && !templateQueryState.isError && templates.length === 0 && <section className="fh-estimate-library"><h2>No templates yet</h2><p>Build an estimate, then save its scope and line items as a reusable template.</p><Link to="/bid?view=builder">Build an estimate</Link></section>}

      {/* TEMPLATES RAIL, surfaces saved estimate templates above the
          scope input so the operator can load a previous bid as a
          starting point instead of typing or re-running the AI. Only
          renders when at least one template exists. */}
      {workspaceView !== 'quotes' && templates.length > 0 && (
        <motion.div
          className="fh-bid-workspace__templates"
          variants={item}
          style={{ padding: '0 var(--v3-gutter) 12px' }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <Eyebrow>
              Your templates
              <span style={{ marginLeft: 6, color: 'var(--v3-text-faint, var(--v3-text-muted))' }}>
                · {templates.length}
              </span>
            </Eyebrow>
            {workspaceView !== 'templates' && (
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
              aria-controls="estimate-template-browser"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--v3-primary-text)',
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                letterSpacing: 0, cursor: 'pointer', padding: '8px 0', minHeight: 44
              }}
            >
              {pickerOpen ? 'Hide' : 'Browse all'}
            </button>
            )}
          </div>
          {pickerOpen || workspaceView === 'templates' ? (
            <div id="estimate-template-browser">
              <p style={{ fontSize: 14, color: 'var(--v3-text-muted)' }}>Favorites and library categories follow your account. Categories describe how you use a template.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                <label style={{ display: 'grid', gap: 8, flex: '1 1 180px', fontSize: 14 }}>Library view
                  <select value={libraryFilter} onChange={event => setLibraryFilter(event.target.value)} style={{ minHeight: 44, padding: 12, fontSize: 16, borderRadius: 10, color: 'var(--v3-text)', background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)' }}>
                    <option value="all">All templates</option><option value="favorites">Favorites</option><option value="reusable">Reusable templates</option><option value="imported">Imported references</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 8, flex: '1 1 240px', fontSize: 14 }}>
                  Search templates
                  <input type="search" value={templateQuery} onChange={event => setTemplateQuery(event.target.value)}
                    placeholder="Name, scope or material" style={{ minHeight: 44, padding: 12, fontSize: 16, borderRadius: 10, color: 'var(--v3-text)', background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)' }} />
                </label>
                <label style={{ display: 'grid', gap: 8, flex: '1 1 180px', fontSize: 14 }}>
                  Template job type
                  <select value={templateType} onChange={event => setTemplateType(event.target.value)}
                    style={{ minHeight: 44, padding: 12, fontSize: 16, borderRadius: 10, color: 'var(--v3-text)', background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)' }}>
                    <option value="">All job types</option>
                    {templateTypes.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
              </div>
              <p aria-live="polite" style={{ fontSize: 14 }}>{matchingTemplates.length} of {templates.length} templates</p>
              {matchingTemplates.length === 0 && <p>No templates match. Try another search or job type.</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {matchingTemplates.map((t) => (
                <li key={t.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, alignItems: 'center', padding: '12px 12px', borderRadius: 10, background: 'var(--v3-surface)', border: '1px solid var(--v3-border)' }}>
                  <button
                    type="button"
                    onClick={() => loadTemplate(t)}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      textAlign: 'left', cursor: 'pointer',
                      color: 'var(--v3-text)', minWidth: 0,
                      display: 'flex', flexDirection: 'column', gap: 4
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)' }}>
                      {((t.line_items || []) as any[]).length} item{((t.line_items || []) as any[]).length === 1 ? '' : 's'}
                      {t.total_high ? ` · ${money(t.total_high)}` : ''}
                      {t.job_type ? ` · ${capitalize(t.job_type)}` : ''}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>
                      {templatePreferences(profile?.preferences, t.id).category === 'imported' ? 'Imported reference' : 'Reusable template'} · Updated {new Date(t.updated_at).toLocaleDateString()}
                      {Array.isArray(t.line_items) && t.line_items.length > 0
                        ? ` · Units: ${Array.from(new Set((t.line_items as any[]).map(line => line?.unit).filter(Boolean))).join(', ') || 'per item'}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadTemplate(t)}
                    style={{
                      padding: '8px 12px', borderRadius: 10, minHeight: 44,
                      background: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                      color: 'var(--v3-primary-text)',
                      fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                      letterSpacing: 0, cursor: 'pointer'
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTap.tap(t.id, () => { void deleteTemplate(t) })}
                    aria-label={deleteTap.armedId === t.id ? 'Tap again to delete' : `Delete template ${t.name}`}
                    title={deleteTap.armedId === t.id ? `Tap again to delete "${t.name}" from your templates` : 'Delete template'}
                    style={{
                      width: deleteTap.armedId === t.id ? 'auto' : 44, minHeight: 44, borderRadius: 10, padding: deleteTap.armedId === t.id ? '0 8px' : 0,
                      fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'transparent',
                      border: '1px solid rgba(192, 57, 43, 0.35)',
                      color: 'var(--v3-danger-text)', cursor: 'pointer'
                    }}
                  >
                    {deleteTap.armedId === t.id ? 'Tap again to delete' : <Trash2 size={12} aria-hidden="true" />}
                  </button>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                    <button type="button" disabled={templateSaving !== null} aria-pressed={templatePreferences(profile?.preferences, t.id).favorite}
                      aria-label={`${templatePreferences(profile?.preferences, t.id).favorite ? 'Remove favorite' : 'Favorite'} ${t.name}`}
                      onClick={() => { void saveTemplatePreference(t.id, { favorite: !templatePreferences(profile?.preferences, t.id).favorite }) }}
                      style={{ minHeight: 44, padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--v3-border)', borderRadius: 'var(--fh-r-control)', background: 'var(--v3-surface)', color: 'var(--v3-primary-text)' }}>
                      <Star size={16} fill={templatePreferences(profile?.preferences, t.id).favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                      {templatePreferences(profile?.preferences, t.id).favorite ? 'Favorited' : 'Favorite'}
                    </button>
                    <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 14 }}>Library category
                      <select aria-label={`Category for ${t.name}`} value={templatePreferences(profile?.preferences, t.id).category} disabled={templateSaving !== null}
                        onChange={event => { void saveTemplatePreference(t.id, { category: event.target.value as 'reusable' | 'imported' }) }}
                        style={{ minHeight: 44, padding: 8, border: '1px solid var(--v3-border-strong)', borderRadius: 'var(--fh-r-control)', fontSize: 16, color: 'var(--v3-text)', background: 'var(--v3-surface)' }}>
                        <option value="reusable">Reusable template</option><option value="imported">Imported reference</option>
                      </select>
                    </label>
                    {templateSaving === t.id && <span role="status">Saving library preference…</span>}
                  </div>
                </li>
              ))}
            </ul>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {templates.slice(0, 6).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => loadTemplate(t)}
                  style={{
                    padding: '8px 12px', borderRadius: 10,
                    background: 'var(--v3-surface)',
                    border: '1px solid var(--v3-border-strong)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                    maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis'
                  }}
                >
                  {t.name}
                </button>
              ))}
              {templates.length > 6 && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  style={{
                    padding: '8px 12px', borderRadius: 10,
                    background: 'transparent', border: '1px dashed var(--v3-border-strong)',
                    color: 'var(--v3-text-muted)',
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  +{templates.length - 6} more
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}

      {workspaceView === 'builder' && <>
      {/* SCOPE INPUT CARD, primary workspace */}
      <motion.div
        variants={item}
        className="v3-section fh-bid-workspace__scope"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader label="Scope" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
          {/* Scope textarea */}
          <textarea
            aria-label="Estimate scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={5}
            placeholder="1,800 sqft rambler. Demo kitchen + two baths. New cabinets, LVP throughout, tile surrounds, electrical rough in for island. Permit pulled."
            style={{
              width: '100%',
              padding: '12px 12px',
              borderRadius: 10,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              lineHeight: 1.5,
              resize: 'vertical',
              minHeight: 120,
              boxSizing: 'border-box'
            }}
          />

          {/* Job type chips */}
          <div>
            <span className="v3-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Job type</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {JOB_TYPES.map((jt) => (
                <FilterPill
                  key={jt.value}
                  size="sm"
                  active={jobType === jt.value}
                  onClick={() => setJobType(jt.value === jobType ? '' : jt.value)}
                >
                  {jt.label}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* Trades chips */}
          <div>
            <span className="v3-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Trades on job</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {TRADES.map((t) => (
                <FilterPill
                  key={t}
                  size="sm"
                  active={picks.includes(t)}
                  onClick={() => togglePick(t)}
                >
                  {TRADE_LABELS[t] || t}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* Target margin slider */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="v3-eyebrow">Target margin</span>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                color: 'var(--v3-primary-text)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {marginPct}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={50}
              step={1}
              value={marginPct}
              onChange={(e) => setMarginPct(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--v3-primary)' }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0,
              color: 'var(--v3-text-muted)',
              marginTop: 4
            }}>
              <span>10%</span>
              <span>30%</span>
              <span>50%</span>
            </div>
          </div>

          {/* Primary CTA */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => { hapticMedium(); generate() }}
            disabled={!scope.trim() || generating}
            style={{
              marginTop: 4,
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
              background: !scope.trim() || generating
                ? 'var(--v3-surface-2)'
                : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
              color: !scope.trim() || generating ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0,
              cursor: !scope.trim() || generating ? 'default' : 'pointer',
              boxShadow: !scope.trim() || generating
                ? 'none'
                : '0 0 0 3px rgba(201, 150, 58, 0.16), 0 6px 18px rgba(201, 150, 58, 0.32), 0 1px 0 var(--v3-border-strong) inset',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 48,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {generating ? (
              <span aria-label="Loading" style={{ width: 14, height: 14, borderRadius: 10, border: '2px solid rgba(20, 20, 20,0.25)', borderTopColor: 'var(--v3-on-primary)', animation: 'fh-spin 700ms linear infinite' }} />
            ) : (
              <Sparkles size={16} />
            )}
            {generating ? 'Generating estimate…' : 'Generate Estimate'}
          </motion.button>

          {/* Error block, graceful degradation */}
          {err && (
            <div role="alert" style={{
              padding: '12px 12px',
              borderRadius: 10,
              background: 'var(--v3-danger-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              lineHeight: 1.5
            }}>
              <div style={{ fontWeight: 700, color: 'var(--v3-danger-text)', marginBottom: 4 }}>AI unavailable</div>
              <div style={{ color: 'var(--v3-text-muted)', marginBottom: 10 }}>
                {err}, your scope is preserved. Fill in line items manually if you need this estimate out the door.
              </div>
              <button
                type="button"
                onClick={() => {
                  setErr('')
                  setBid({
                    summary: scope,
                    job_type: jobType || 'Renovation',
                    line_items: (picks.length ? picks : ['gc']).map((trade) => ({
                      name: userRates[trade]?.label || TRADE_LABELS[trade] || trade,
                      trade,
                      qty: 1,
                      unit: userRates[trade]?.unit || RATE_CARD[trade]?.unit || 'lot',
                      rate_low: userRates[trade]?.low ?? RATE_CARD[trade]?.low ?? 0,
                      rate_high: userRates[trade]?.high ?? RATE_CARD[trade]?.high ?? 0,
                      notes: ''
                    })),
                    risks: [],
                    assumptions: []
                  })
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'var(--v3-surface-2)',
                  color: 'var(--v3-text)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Fill manually →
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* OUTPUT CARD, empty state OR generated estimate */}
      <AnimatePresence mode="wait">
        {bid && total ? (
          <motion.div
            key="result"
            variants={item}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="v3-section v3-section--primary fh-bid-workspace__result"
            style={{ margin: '0 var(--v3-gutter) 28px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
              <span className="v3-eyebrow" style={{ color: 'var(--v3-primary-text)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={11} />
                Recommended price · {marginPct}% margin
              </span>
              <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={saveAsTemplate}
                  disabled={savingTemplate}
                  title="Save this bid as a reusable template"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--v3-border-strong)',
                    background: 'var(--v3-surface-2)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: savingTemplate ? 'wait' : 'pointer',
                    opacity: savingTemplate ? 0.7 : 1
                  }}
                >
                  <BookmarkPlus size={12} />
                  {savingTemplate ? 'Saving…' : 'Save template'}
                </button>
                <button
                  type="button"
                  onClick={copyEstimate}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--v3-border-strong)',
                    background: 'var(--v3-surface-2)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <input
                  type="text"
                  list="fh-bid-clients"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client name"
                  aria-label="Client for the quote"
                  autoComplete="off"
                  style={{
                    minWidth: 0,
                    flex: '1 1 160px',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--v3-border-strong)',
                    background: 'var(--v3-surface-2)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14,
                    outline: 'none'
                  }}
                />
                <datalist id="fh-bid-clients">
                  {clients.map((c: any) => <option key={c.id} value={c.name || ''} />)}
                </datalist>
                <button
                  type="button"
                  onClick={pushToJob}
                  disabled={pushing}
                  title="Make a quote for the named client with these line items filled, ready to refine and send"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                    background: 'var(--v3-primary)',
                    minHeight: 44,
                    color: 'var(--v3-on-primary)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0,
                    cursor: pushing ? 'wait' : 'pointer',
                    opacity: pushing ? 0.7 : 1
                  }}
                >
                  <Briefcase size={12} />
                  {pushing ? 'Creating' : 'Push to quote'}
                </button>
              </div>
            </div>

            {/* Headline price */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <motion.div
                className="v3-money"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 240, damping: 22 }}
                style={{
                  fontSize: 24,
                  lineHeight: 0.95,
                  letterSpacing: 0,
                  color: 'var(--v3-text)'
                }}
              >
                <CountUp to={Math.round(total.withMargin)} duration={0.9} prefix="$" formatter={formatThousands} />
              </motion.div>
              <span className="v3-caption" style={{ fontSize: 12 }}>
                Raw range: {money(total.low)} to {money(total.high)}
              </span>
            </div>

            {/* Summary line if present */}
            {bid.summary && (
              <p style={{
                margin: '12px 0 0',
                padding: '12px 12px',
                borderRadius: 10,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                lineHeight: 1.5
              }}>
                {bid.summary}
              </p>
            )}

            {/* Line items */}
            <div style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid var(--v3-border)'
            }}>
              <SectionHeader label="Line items" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {bid.line_items?.map((li: any, i: any) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                      gap: 12,
                      alignItems: 'center',
                      padding: '12px 12px',
                      borderRadius: 10,
                      background: 'var(--v3-surface)',
                      border: '1px solid var(--v3-border)'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--v3-text)'
                      }}>
                        {li.name}
                      </div>
                      {li.notes && (
                        <div style={{ marginTop: 2, fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.4 }}>
                          {li.notes}
                        </div>
                      )}
                    </div>
                    <span style={{
                      flexShrink: 0,
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      color: 'var(--v3-text-muted)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {li.qty || 1} {li.unit}
                    </span>
                    <span style={{
                      flexShrink: 0,
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      color: 'var(--v3-text)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {money((li.rate_low || 0) * (li.qty || 1))} to {money((li.rate_high || 0) * (li.qty || 1))}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Assumptions */}
            {bid.assumptions?.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--v3-border)' }}>
                <SectionHeader label="Assumptions" />
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55 }}>
                  {bid.assumptions.map((a: any, i: any) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
                </ul>
              </div>
            )}

            {/* Risks */}
            {bid.risks?.length > 0 && (
              <div style={{
                marginTop: 14,
                padding: '12px 12px',
                borderRadius: 10,
                background: 'var(--v3-danger-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-danger) 30%, transparent)'
              }}>
                <span className="v3-eyebrow" style={{ color: 'var(--v3-danger-text)' }}>Risks</span>
                <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55 }}>
                  {bid.risks.map((r: any, i: any) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
                </ul>
              </div>
            )}
          </motion.div>
        ) : (
          /* Empty state, polished */
          <motion.div
            key="empty"
            variants={item}
            className="v3-section fh-bid-workspace__result"
            style={{ margin: '0 var(--v3-gutter) 28px' }}
          >
            <div style={{
              padding: '32px 24px',
              textAlign: 'center',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)'
            }}>
              <div style={{
                margin: '0 auto 14px',
                width: 48,
                height: 48,
                borderRadius: 10,
                background: 'var(--v3-primary-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--v3-primary-text)'
              }}>
                <FileText size={20} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                Your estimate will appear here.
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                Describe the scope above, pick a job type and trades, then tap <strong style={{ color: 'var(--v3-primary-text)' }}>Generate Estimate</strong>.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </>}
    </motion.div>
  )
}

