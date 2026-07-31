import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { motion } from 'framer-motion'
import {
  CloudSun,
  MapPin,
  Plus,
  CalendarRange,
  Receipt,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  PhoneCall,
  PenLine,
  CalendarClock,
  ChevronRight,
  Zap
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { detailRoute } from '../lib/stages.ts'
import { getWeather, MURFREESBORO } from '../lib/weather.ts'
import { useFhMotion } from '../lib/motion.ts'
import CountUp from '../components/fx/CountUp.tsx'
import { Eyebrow, QuickAction, SectionHeader, ScreenCloser, StatusPill } from '../components/v3'
import HomeActivityCard from '../components/HomeActivityCard.tsx'
import { hapticTap } from '../lib/haptics.ts'
import { canHover } from '../lib/hover.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import DataErrorState from '../components/DataErrorState.tsx'
import { useHomeDashboard, useHomeDashboardRealtime } from '../lib/homeDashboard.ts'
// Lazy, desktop-only variant. Home itself is an eager route (loaded
// with the main bundle) so any static import here ships SnowHome to
// mobile users too even though they never render it. Lazy keeps the
// main bundle lean; desktop sees a near-instant suspense flash since
// the chunk fetches in parallel with first paint.
const SnowHome = lazy(() => import('../components/desktop/SnowHomeBuild.tsx'))

const EMPTY_PHOTO_URLS: Record<string, string> = {}

/* ----------------- helpers ----------------- */

function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning,'
  if (h < 17) return 'Good afternoon,'
  return 'Good evening,'
}

function emailFirstToken(email: any) {
  if (!email) return ''
  const raw = email.split('@')[0].split(/[._-]/).filter(Boolean)[0] || ''
  return raw ? raw[0].toUpperCase() + raw.slice(1) : ''
}

function displayNameFrom(profile: any, user: any) {
  // Multi-tenant guard: profile must belong to the current auth user.
  // Without this, a stale profile row left in context during a sign-out
  // → sign in transition can leak the prior user's name onto the greeting.
  const profileMatchesUser = profile && user && profile.user_id === user!.id
  const full = profileMatchesUser ? profile.full_name?.trim() : ''
  if (full) return full
  return emailFirstToken(user?.email)
}

// Map Open-Meteo weather_code to a short label. Covers the common buckets;
// rare codes fall through to "\u2003" so we don't lie about the conditions.
function weatherLabel(code: any) {
  if (code == null) return ''
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Partly cloudy'
  if (code <= 3) return 'Overcast'
  if (code <= 48) return 'Foggy'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 99) return 'Storms'
  return ''
}

/* ----------------- screen ----------------- */

export default function Home() {
  const { user } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const navigate = useNavigate()

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Weather
  const [weather, setWeather] = useState<any>(null)
  const [weatherErr, setWeatherErr] = useState('')

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const displayName = displayNameFrom(profile, user)
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'there'
  const membership = useMembership()
  const dashboard = useHomeDashboard(user?.id, membership.orgId)
  useHomeDashboardRealtime(user?.id, membership.orgId)
  const dashboardData = dashboard.data
  const pipeline = dashboardData?.pipeline ?? null
  const pipelinePrev = dashboardData?.pipelinePrev ?? null
  const dealsAtRisk = dashboardData?.dealsAtRisk ?? null
  const jobsBehind = dashboardData?.jobsBehind ?? null
  const invoicingWeek = dashboardData?.invoicingWeek ?? null
  const topPipeline = dashboardData?.topPipeline ?? null
  const jobHealth = dashboardData?.jobHealth ?? null
  const stageBreakdown = dashboardData?.stageBreakdown ?? null
  const stageRailData = dashboardData?.stageRail ?? null
  const todayOnSite = dashboardData?.todayOnSite ?? null
  const nextActions = dashboardData?.nextActions ?? null
  const photoUrlByJob = dashboardData?.photoUrlByJob ?? EMPTY_PHOTO_URLS
  const dashboardError = dashboard.error instanceof Error
    ? dashboard.error.message
    : dashboard.error
      ? 'Dashboard data could not refresh.'
      : ''

  /* ----- Weather ----- */
  useEffect(() => {
    let cancelled = false
    const lat = profile?.location_lat ?? MURFREESBORO.lat
    const lon = profile?.location_lon ?? MURFREESBORO.lon
    setWeatherErr('')
    getWeather(lat, lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setWeatherErr(e.message || 'Forecast unavailable') })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon])

  function pinLocation() {
    if (!('geolocation' in navigator)) return setWeatherErr('Geolocation not supported')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await upsertProfile({ location_lat: pos.coords.latitude, location_lon: pos.coords.longitude })
        refresh()
      },
      () => setWeatherErr('Location denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    )
  }

  /* ----- Derived ----- */
  const trendUp = pipeline != null && pipelinePrev != null && pipeline >= pipelinePrev
  const trendPct = useMemo(() => {
    if (pipeline == null || pipelinePrev == null || pipelinePrev <= 0) return null
    const pct = ((pipeline - pipelinePrev) / pipelinePrev) * 100
    if (!Number.isFinite(pct)) return null
    return Math.round(pct)
  }, [pipeline, pipelinePrev])

  // Empty while loading, consumers show a shimmer or ellipsis instead
  // of a printed dash (user-facing copy carries no dashes).
  const tempStr = weather?.current?.temperature_2m != null
    ? `${Math.round(weather.current.temperature_2m)}°`
    : ''
  const condStr = weatherLabel(weather?.current?.weather_code)
  const followUpCount = dealsAtRisk?.followUps ?? null
  const quoteAttentionCount = dealsAtRisk?.quotesAttention ?? null
  const jobsBehindCount = jobsBehind ?? null

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  // Role-based redirect: foreman + crew don't see the owner dashboard
  // (no $ amounts, no AR, no pipeline). Send them straight to /crew,
  // which surfaces their own schedule + own punches + own tasks.
  // We wait for membership to resolve so the redirect doesn't fire
  // mid-fetch and flap the URL.
  if (!membership.loading && (membership.role === 'crew' || membership.role === 'foreman')) {
    return <Navigate to="/crew" replace />
  }

  // Sub-only redirect: an authenticated user with NO org membership
  // is, in practice, somebody who accepted a partner invite (or
  // signed up without onboarding). Land them on /sub-portal, the
  // owner dashboard would 403 every query they made.
  if (!membership.loading && !membership.role && !membership.orgId) {
    return <Navigate to="/sub-portal" replace />
  }

  // Phase 10, desktop dispatch. At >=900px the new
  // DesktopHomeCommandCenter renders the full command-center layout
  // using the same data this screen already fetches. Below 900px the
  // existing motion.div.v3-screen--home flow renders verbatim.
  if (isDesktop) {
    return (
      <Suspense fallback={null}>
        <SnowHome
          firstName={firstName}
          now={now}
          hasCoords={hasCoords}
          tempStr={tempStr}
          condStr={condStr}
          weatherErr={weatherErr}
          pinLocation={pinLocation}
          pipeline={pipeline}
          trendUp={trendUp}
          trendPct={trendPct}
          stageBreakdown={stageBreakdown}
          stageRail={stageRailData}
          jobHealth={jobHealth}
          dealsAtRisk={dealsAtRisk}
          jobsBehind={jobsBehind}
          invoicingWeek={invoicingWeek}
          todayOnSite={todayOnSite}
          topPipeline={topPipeline}
          nextActions={nextActions}
          dashboardError={dashboardError}
          onRetryDashboard={() => { dashboard.refetch() }}
          onGoToJobs={(filter: any) => navigate(filter ? `/jobs?stage=${filter}` : '/jobs')}
          onGoToPipeline={() => navigate('/pipeline')}
          onGoToLeads={(filter?: string) => navigate(filter ? `/leads?stage=${filter}` : '/leads')}
          onGoToQuotes={() => navigate('/quotes')}
          onGoToActivity={() => navigate('/activity')}
          onGoToSchedule={() => navigate('/schedule')}
          onGoToInvoices={() => navigate('/invoices')}
          onGoToBid={() => navigate('/bid')}
          onGoToCompose={() => navigate('/compose')}
          onGoToPourWindow={() => navigate('/pour-window')}
          onOpenJob={(id: any) => navigate(`/jobs/${id}`)}
          onOpenJobAtTab={(id: any, tab: any, intent: any) => navigate(jobActionPath(id, tab, intent))}
          onNewLead={() => navigate('/leads?new=1')}
        />
      </Suspense>
    )
  }

  /* ----- Render -----
     v3 hierarchy refactor (3-tier):
       TIER 1, HERO: dominant card on --v3-surface-2 (#141414 elevated),
                 oversized money + sparkline, hover lift, deep shadow
       TIER 2, PRIMARY KPIs: compact tiles on --v3-surface (#141414),
                 muted body + colored accent only, smaller numerics
       TIER 3, SECONDARY: Quick Actions (primary tile gets gold halo,
                 others sit flat) + Live Feed (rows with hover lift)

     Asymmetric spacing breaks the rigid grid:
       - Greeting: 12px top → 24px bottom (more air below)
       - Hero: 28px below (most elevated → most room)
       - KPI row: 24px below
       - Section headers: 4px below
       - Quick Actions: 28px below
       - Live Feed: 40px below
  */
  return (
    <motion.div
      className="v3-screen v3-screen--home"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 48, background: 'var(--v3-bg)' }}
    >
      {/* ─────────── COMPACT GREETING STRIP, V3-HOME-1 ───────────
          Demoted from 36pt serif italic h1 to a single sans 14pt muted
          line so the AppHeader wordmark and the operator command data
          (pipeline + next actions) stay dominant. Date eyebrow stays.
          Weather chip stays on the right. */}
      <motion.div
        variants={item}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          // V3-SYSTEM-1B-1: greeting strip pad 10/16/10 → 8/16/6 so the
          // first card sits ~6px closer to the header.
          padding: '8px 16px 8px'
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Date eyebrow stays muted ink (not gold) so the gold accent
              on the operator's first name below carries the brand moment
              alone. Kit wave 3: rides the Eyebrow primitive. */}
          <Eyebrow>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            {' · '}
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Eyebrow>
          {/* Hero greeting, ports the design's "Good morning, *Jesse.*" pattern
              with the italic gold accent on the first name. font-display so the
              greeting reads as a screen title, not a caption. */}
          <h1 style={{
            margin: '4px 0 0',
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            lineHeight: 1.1,
            letterSpacing: 0,
            color: 'var(--v3-text)',
            /* Wraps to two lines on narrow phones, never truncate the
               user's own name ("Good afternoon, Cl…" read as broken). */
            overflowWrap: 'anywhere'
          }}>
            {greetingPrefix().replace(',', '')},{' '}
            <span style={{
              color: 'var(--v3-primary)',
              letterSpacing: 0
            }}>{firstName}.</span>
          </h1>
        </div>

        {hasCoords ? (
          /* V3-SYSTEM-1B-1: weather pill compacted, pad 10/12 → 6/10,
             icon 18 → 16, temp 14 → 13, condition subline dropped (the
             small uppercase line ate ~11px and the temp+icon already
             telegraphs weather). Pill height 44 → 32. */
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={() => { hapticTap(); navigate('/pour-window') }}
            aria-label={condStr ? `Open weather forecast, ${condStr}` : 'Open weather forecast'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 'var(--v3-radius-btn)',
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)',
              cursor: 'pointer',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <CloudSun size={16} color="#F2EDE4" aria-hidden="true" />
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1
            }}>
              {tempStr || '…'}
            </span>
          </motion.button>
        ) : (
          <button
            type="button"
            onClick={pinLocation}
            aria-label="Pin location for weather"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 12px',
              minHeight: 40,
              borderRadius: 'var(--v3-radius-btn)',
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
              color: 'var(--v3-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <MapPin size={14} />
            Pin
          </button>
        )}
      </motion.div>
      {weatherErr && !hasCoords ? (
        <div className="v3-caption" style={{ padding: '0 var(--v3-gutter) 12px', color: 'var(--v3-danger)' }}>
          {weatherErr}
        </div>
      ) : null}
      {dashboardError ? (
        <motion.div variants={item} style={{ margin: '0 var(--v3-gutter) 16px' }}>
          <DataErrorState
            compact
            title="Dashboard data couldn't refresh"
            message={dashboardError}
            onRetry={() => { dashboard.refetch() }}
          />
        </motion.div>
      ) : null}

      {/* ─────────── PIPELINE REVENUE CARD, V3-HOME-1D ───────────
          Mockup-faithful revenue moment. Eyebrow reframed from
          "Total Pipeline" descriptor to "Today's Revenue Opportunity"
          aspirational header (muted, not gold). Money stays the gold
          anchor with a calm halo. Trend renders as inline colored text
         , no Pill chip chrome. "Total Pipeline" demoted to a sublabel
          beneath the figure. The Won/Active/Lead segmented bar + dotted
          legend is retired in favor of a single muted text caption. A
          1px gold hairline sweep sits under the sublabel as decorative
          brand luminance, presentation only, not a fake chart.
          Card-top gold accent stripe + View-all link removed: gold is
          scarce here, only the money + the small sweep wear it. */}
      {/* Findings 66 + 69: the outer card is no longer a role="button"
          wrapper, it contained real <button> breakdown cells, which
          violates the button content model (no nested interactive
          controls). It's now a plain container. The "Open pipeline"
          affordance is an explicit inner <button> (the eyebrow + money
          block); the breakdown cells stay as their own sibling buttons.
          The open-pipeline button navigates to '/work' (all stages) so
          the destination matches the WHOLE-pipeline figure shown, the
          old '/jobs' redirected to Active-only, a mismatch. */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{
          position: 'relative',
          overflow: 'hidden',
          // V3-SYSTEM-1B-1: section-to-section margin 14 → 12, card pad
          // 14/18 → 12/16, radius (token default 20) → 16. Home-only
          // density override; tokens stay alone for other screens.
          // Polish pass: hero card pad 12/16 → 18/20 + section gap
          // 12 → 16. The hero is the most important card on this
          // screen; giving it breathing room and a more generous
          // gutter against the next card reads premium instead of
          // dense.
          margin: '0 var(--v3-gutter) 16px',
          padding: '16px 24px',
          borderRadius: 10,
          // Glass-metal depth from V3-HOME-1C, kept verbatim. Inset top
          // highlight + inset bottom shadow + crisp outline + soft halo.
          border: '1px solid var(--v3-border-strong)',
          boxShadow: [
            'inset 0 1px 0 var(--v3-glass-tint-2)',
            'inset 0 -1px 0 rgba(20, 20, 20, 0.18)',
            '0 1px 2px rgba(20, 20, 20, 0.40)',
            '0 12px 28px rgba(20, 20, 20, 0.30)'
          ].join(', ')
        }}
      >
        {/* Open-pipeline affordance, an explicit button wrapping the
            eyebrow + money block. This is the card's single primary
            control; keyboard access (Enter/Space) comes free from the
            native <button>. The breakdown cells below are siblings, not
            nested inside this button. */}
        <motion.button
          type="button"
          aria-label="Open pipeline"
          whileTap={{ scale: 0.995 }}
          onClick={() => { hapticTap(); navigate('/work') }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            padding: 0,
            margin: 0,
            color: 'inherit',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          {/* Eyebrow, muted ink, slightly looser tracking than the v3
              default to give the longer phrase room. */}
          <span className="v3-eyebrow" style={{
            display: 'block',
            color: 'var(--v3-text-muted)',
            letterSpacing: 0
          }}>
            Total Pipeline
          </span>

          {/* Money + trend row, money baseline-aligned with a tiny
              gold-bronze $ glyph and an inline arrow+pct trend. No Pill
              chip; trend is just colored text. */}
          <div style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'nowrap'
          }}>
          <div style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-body)',
            // Polish pass: hero money 32 → 38px. The pipeline number is
            // the operator's "you're worth X right now" moment; bigger
            // type makes it feel like a serious dashboard, not a quick
            // status. Letter-spacing tightened from -0.012em to -0.018em
            // because larger numbers benefit from more aggressive
            // tracking.
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 0,
            color: 'var(--v3-primary)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 0 14px color-mix(in srgb, var(--v3-primary) 22%, transparent)'
          }}>
            {pipeline == null ? (
              <span className="v3-skeleton" style={{ width: 160, height: 30, borderRadius: 10 }} />
            ) : (
              <>
                <span style={{
                  // $ glyph scales with the hero number: 22 → 26 to
                  // keep its baseline relationship to the larger digit.
                  fontSize: 24,
                  fontWeight: 600,
                  marginRight: 1,
                  color: 'color-mix(in srgb, var(--v3-primary) 70%, var(--v3-text-muted))',
                  textShadow: 'none'
                }}>
                  $
                </span>
                <CountUp to={pipeline} formatter={(n) => n.toLocaleString()} />
              </>
            )}
          </div>
          {trendPct != null && trendPct !== 0 && (
            <span style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0,
              color: trendUp ? 'var(--v3-success-bright)' : 'var(--v3-danger-bright)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1
            }}>
              {trendUp
                ? <ArrowUpRight size={11} aria-hidden="true" />
                : <ArrowDownRight size={11} aria-hidden="true" />}
              {trendUp ? '+' : ''}{trendPct}% · 7d
            </span>
          )}
          </div>
        </motion.button>

        {/* NOTE: a synthesized always-ascending sparkline used to sit here.
            It rendered "up and to the right" regardless of the real number :
            it could sweep upward next to a negative trend chip. Removed: the
            honest trend chip above and the real Won/Active/Lead breakdown
            below carry the pipeline story with actual data. */}

        {/* Won / Active / Lead breakdown, ports the design's pipeline-hero__breakdown.
            Three cells, colored dot + label + stamp amount + count. Each cell
            is a tap target → Jobs filtered by that stage. */}
        {stageBreakdown != null && (
          <div style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--v3-border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12
          }}>
            <PipelineBreakdownCell
              dotColor="var(--v3-success-bright, #5C5C5C)"
              label="Won"
              count={stageBreakdown.won}
              tone="success"
              onClick={(e: any) => { e.stopPropagation(); hapticTap(); navigate('/jobs?stage=closed') }}
            />
            <PipelineBreakdownCell
              dotColor="var(--v3-primary)"
              label="Active"
              count={stageBreakdown.active}
              tone="gold"
              onClick={(e: any) => { e.stopPropagation(); hapticTap(); navigate('/jobs?stage=active') }}
            />
            <PipelineBreakdownCell
              dotColor="#5C5C5C"
              label="Lead"
              count={stageBreakdown.lead}
              tone="muted"
              onClick={(e: any) => { e.stopPropagation(); hapticTap(); navigate('/leads') }}
            />
          </div>
        )}
      </motion.div>

      {/* ─────────── QUICK ACTIONS, TOOLBAR ───────────
          Header + 4-tile launcher row on the page surface. Trimmed from
          five to four so each tile gets real width (~83px on a 390px
          phone vs ~59px at 5-up, which cramped the two-word "Voice Note"
          label). The four are the pipeline-money actions, Add Lead,
          New Job, Schedule, Invoice, sitting in the first thumb-reach
          zone right after the revenue moment. Voice capture wasn't lost:
          it lives on the Notes screen (mic button + ?voice=1), reachable
          from the header Notes shortcut. Desktop uses
          DesktopHomeCommandCenter and is unaffected. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
      >
        <SectionHeader label="Quick Actions" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            marginTop: 4
          }}
        >
          <QuickAction icon={Plus} label="Add Lead" primary onTap={() => navigate('/leads?new=1')} />
          <QuickAction icon={FileText} label="New Job" onTap={() => navigate('/jobs?new=1&asStage=job')} />
          <QuickAction icon={CalendarRange} label="Schedule" onTap={() => navigate('/schedule')} />
          <QuickAction icon={Receipt} label="Invoice" onTap={() => navigate('/invoices')} />
        </div>
      </motion.div>

      {/* ─────────── NEXT ACTIONS, IMMEDIATE WORK ───────────
          Promoted ABOVE Recent Activity: this is the "what do I do right now"
          list (overdue invoices, follow-ups), so it must come before the
          passive cross-job feed. V3-HOME-2 de-box: the row cards self-frame. */}
      {nextActions != null && nextActions.length > 0 && (
        <motion.div
          variants={item}
          style={{
            margin: '0 var(--v3-gutter) 16px'
          }}
        >
          <div className="v3-section-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
                Next Actions
              </span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 18,
                height: 18,
                padding: '0 8px',
                borderRadius: 10,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1
              }}>
                {nextActions.length}
              </span>
            </span>
            <button
              type="button"
              onClick={() => { hapticTap(); navigate('/jobs') }}
              className="v3-section-link"
              style={{ color: 'var(--v3-text-muted)', transition: 'color 160ms ease' }}
              onMouseEnter={(e) => { if (canHover) e.currentTarget.style.color = 'var(--v3-primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--v3-text-muted)' }}
            >
              View all
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {nextActions.map((action: any) => (
              <NextActionRow
                key={action.id}
                action={action}
                photoUrl={action.contactId ? photoUrlByJob[action.contactId] : undefined}
                onTap={() => navigate(nextActionPath(action))}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* ─────────── RECENT ACTIVITY, cross-job feed ───────────
          Now below Next Actions: it's reference, not action. Compact 5-row
          card that mirrors /activity on the dashboard surface; auto-hides on
          a brand-new account. "See all" links through to /activity. */}
      <motion.div variants={item} style={{ padding: '8px 24px 12px' }}>
        <HomeActivityCard />
      </motion.div>

      {/* ─────────── TODAY'S PRIORITIES, KPI strip ───────────
          V3-HOME-2 un-nest: dropped the bordered wrapper that nested
          three already-bordered tiles inside another box. Tiles render
          directly on the page surface as a clean 3-column KPI strip.
          Tile internals (V3-SYSTEM-1B-1: 72px minHeight, 22pt value,
          danger tone preserved on Jobs Behind, mute-when-zero subline)
          unchanged. Inter-tile gap tightened 10 → 8 so the three tiles
          read as a continuous strip, not loose chips. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
      >
        <SectionHeader label="Today's Priorities" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginTop: 4
          }}
        >
          <CompactKpi
            tone="success"
            icon={PhoneCall}
            value={followUpCount}
            label={followUpCount === 1 ? 'Follow up' : 'Follow ups'}
            subline={followUpCount != null && followUpCount > 0 ? 'Calls to leads' : null}
            onTap={() => navigate('/leads')}
          />
          <CompactKpi
            tone="lead"
            icon={FileText}
            value={quoteAttentionCount}
            label={quoteAttentionCount === 1 ? 'Quote' : 'Quotes'}
            subline={quoteAttentionCount != null && quoteAttentionCount > 0 ? 'Need follow up' : null}
            onTap={() => navigate('/quotes')}
          />
          {/* Tone flips danger→primary only when jobsBehind === 0. A red
              "0 BEHIND" reads as an alarm when it's actually the all-clear
              state (~audit 5/13). Non-zero stays danger so the operator
              still gets the urgent red read when work has actually slipped. */}
          <CompactKpi
            tone={jobsBehindCount != null && jobsBehindCount > 0 ? 'danger' : 'primary'}
            icon={CalendarClock}
            value={jobsBehindCount}
            label={jobsBehindCount === 1 ? 'Job Behind' : 'Jobs Behind'}
            subline={jobsBehindCount != null && jobsBehindCount > 0 ? 'Reschedule' : 'All on track'}
            onTap={() => navigate('/schedule')}
          />
        </div>
      </motion.div>

      {/* ─────────── TODAY ON SITE ───────────
          V3-HOME-2 de-box: header + row stack on page surface. Each
          row is its own self-framing card; no parent panel needed.
          Empty state still uses the dashed v3-empty primitive. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
      >
        <SectionHeader
          label="Today on Site"
          action={{ label: 'View schedule', onTap: () => navigate('/schedule') }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {todayOnSite == null ? (
            <>
              <div className="v3-skeleton" style={{ height: 52, width: '100%', borderRadius: 10 }} />
              <div className="v3-skeleton" style={{ height: 52, width: '100%', borderRadius: 10, opacity: 0.65 }} />
            </>
          ) : todayOnSite.length === 0 ? (
            <div className="v3-empty">
              <CalendarClock size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                Nothing scheduled today.
              </div>
              <div style={{ fontSize: 12 }}>Open Schedule to plan crew visits.</div>
            </div>
          ) : (
            todayOnSite.map((row: any) => (
              <TodayOnSiteRow
                key={row.id}
                row={row}
                photoUrl={row.contactId ? photoUrlByJob[row.contactId] : undefined}
                onTap={() => row.contactId
                  ? navigate(`/jobs/${row.contactId}`)
                  : navigate('/schedule')
                }
              />
            ))
          )}
        </div>
      </motion.div>

      {/* ─────────── PIPELINE PREVIEW ───────────
          Top 3 active deals by value. V3-HOME-2 de-box: header + row
          stack on page surface. Each PipelineDealRow is a self-framed
          glass card already; the bordered wrapper was redundant. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
      >
        <SectionHeader
          label="Pipeline Preview"
          action={{ label: 'View all', onTap: () => navigate('/jobs') }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {topPipeline == null ? (
            <>
              <div className="v3-skeleton" style={{ height: 56, width: '100%', borderRadius: 10 }} />
              <div className="v3-skeleton" style={{ height: 56, width: '100%', borderRadius: 10, opacity: 0.65 }} />
            </>
          ) : topPipeline.length === 0 ? (
            <div className="v3-empty">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                No active deals.
              </div>
              <div style={{ fontSize: 12 }}>Add your first lead to start the pipeline.</div>
            </div>
          ) : (
            topPipeline.map((deal: any) => (
              <PipelineDealRow
                key={deal.id}
                deal={deal}
                photoUrl={photoUrlByJob[deal.id]}
                onTap={() => navigate(pipelineDetailPath(deal))}
              />
            ))
          )}
        </div>
      </motion.div>

      <ScreenCloser caption="Open Leads to add a lead, or open Schedule to plan crew visits." />

    </motion.div>
  )
}

/* ============================================================
   TodayOnSiteRow, single schedule row in Today on Site.
   Time + job/title + stage chip + chevron. Tap → linked job.
   ============================================================ */
function TodayOnSiteRow({ row, photoUrl, onTap }: any) {
  const stage = row.stage ? STAGE_DISPLAY[row.stage] : null
  const startTime = row.startAt
    ? new Date(row.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : ''
  const endTime = row.endAt
    ? new Date(row.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : ''
  const timeLabel = startTime && endTime ? `${startTime} to ${endTime}` : (startTime || 'Anytime')
  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.99 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        // V3-SYSTEM-1B-3: gap 12 → 10 to claw back ~4px when adding the
        // 32px thumbnail + its gap. Row stays comfortable on a 360px phone.
        gap: 12,
        width: '100%',
        // V3-SYSTEM-1B-1: row pad 12/14 → 10/12, radius 12 → 10.
        padding: '12px 12px',
        borderRadius: 10,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 1px 0 var(--v3-glass-tint-2) inset'
      }}
    >
      {/* Time slot, start–end range when both are known */}
      <div style={{
        flexShrink: 0,
        minWidth: endTime ? 100 : 56,
        textAlign: 'center',
        padding: '4px 8px',
        borderRadius: 10,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        fontFamily: 'var(--font-display)',
        fontSize: 14,
        color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0,
        lineHeight: 1.4,
        whiteSpace: 'nowrap'
      }}>
        {timeLabel}
      </div>
      {/* V3-SYSTEM-1B-3: real cover photo for the linked job, falling
          back to a neutral initial tile when no photo exists. Reserves
          its 32×32 space immediately so async photo loads don't shift
          the row. */}
      <RowThumb photoUrl={photoUrl} name={row.clientName || row.title} />
      {/* Title + client */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--v3-text)',
          letterSpacing: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {row.title}
        </div>
        {stage && (
          <Eyebrow as="div" style={{ marginTop: 3, color: stage.color }}>
            {stage.label}
          </Eyebrow>
        )}
      </div>
      <ChevronRight size={16} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}

/* ============================================================
   PipelineDealRow, single deal row inside Pipeline Preview.
   Stage chip on the left + name + amount in Bebas. Hover lifts
   border/background, tap navigates to the contact.
   ============================================================ */
const STAGE_DISPLAY: Record<string, any> = {
  lead:    { label: 'Lead',    color: 'var(--v3-stage-lead)' },
  quote:   { label: 'Quote',   color: 'var(--v3-stage-quote)' },
  job:     { label: 'Job',     color: 'var(--v3-stage-active)' },
  invoice: { label: 'Invoice', color: 'var(--v3-stage-won)' }
}

function PipelineDealRow({ deal, photoUrl, onTap }: any) {
  const stage = STAGE_DISPLAY[deal.stage] || { label: deal.stage, color: 'var(--v3-text-muted)' }
  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.99 }}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        // V3-SYSTEM-1B-3: gap 14 → 12 to make room for the 32px thumb.
        gap: 12,
        width: '100%',
        // V3-SYSTEM-1B-1: row pad 14/14 → 12/12, radius 14 → 12.
        padding: '12px 12px',
        borderRadius: 10,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 1px 0 var(--v3-glass-tint-2) inset, 0 4px 14px rgba(20, 20, 20, 0.30)',
        transition: 'border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease'
      }}
      onMouseEnter={(e) => {
        if (!canHover) return
        // Hover stays neutral, black/charcoal/white. Stage color
        // shows on the spine + label only (functional). No ambient
        // blue/purple bleed onto the card's halo.
        e.currentTarget.style.borderColor = 'var(--v3-border-strong)'
        e.currentTarget.style.background = 'var(--v3-surface-3)'
        e.currentTarget.style.boxShadow = '0 1px 0 var(--v3-glass-tint-2) inset, 0 8px 24px rgba(20, 20, 20, 0.40)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--v3-border-strong)'
        e.currentTarget.style.background = 'var(--v3-surface)'
        e.currentTarget.style.boxShadow = '0 1px 0 var(--v3-glass-tint-2) inset, 0 4px 14px rgba(20, 20, 20, 0.30)'
      }}
    >
      {/* Stage spine, V3-HOME-1B: thinned 5→3px and shortened 36→20px
          so it reads as a stage cue, not an old colored card outline.
          Stage label below the deal name still carries the explicit
          stage signal in its own color. */}
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 3,
        height: 20,
        borderRadius: 10,
        background: `color-mix(in srgb, ${stage.color} 70%, transparent)`
      }} />
      {/* V3-SYSTEM-1B-3: real cover photo (or neutral initial fallback)
          between the stage spine and the deal name block. Reads as a
          job object, not a database row. */}
      <RowThumb photoUrl={photoUrl} name={deal.name} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--v3-text)',
          letterSpacing: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {deal.name}
        </div>
        <Eyebrow as="div" style={{ marginTop: 4, color: stage.color }}>
          {stage.label}
        </Eyebrow>
      </div>
      <div style={{
        flexShrink: 0,
        fontFamily: 'var(--font-display)',
        fontSize: 24,
        color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
        textShadow: '0 1px 0 var(--v3-glass-tint-2)'
      }}>
        ${deal.amount >= 1000
          ? `${(deal.amount / 1000).toFixed(deal.amount >= 10000 ? 0 : 1)}K`
          : deal.amount.toLocaleString()}
      </div>
      <ChevronRight size={18} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}

/* ============================================================
   CompactKpi, Tier-2 KPI tile. Smaller than v3 KpiTile primitive,
   color confined to the value + 1px top accent bar. Hover lift.
   Internal CountUp from the v3 primitive is replaced here with the
   home's own CountUp wiring (already imported above) so we control
   the size + skeleton state.
   ============================================================ */

const COMPACT_TONE: Record<string, any> = {
  primary: { color: 'var(--v3-primary)' },
  success: { color: 'var(--v3-success-bright)' },
  danger:  { color: 'var(--v3-danger-bright)' },
  // warn, bronze/amber from the stage-quote token; reads as "needs attention
  // soon" without claiming the urgency of danger.
  warn:    { color: 'var(--v3-stage-quote)' },
  // lead, steel-blue from the stage-lead token; the closest token-native
  // option to the mockup's lavender for the Quotes tile.
  lead:    { color: 'var(--v3-stage-lead)' }
}

function CompactKpi({ tone = 'primary', value, label, subline, icon: Icon, isMoney, onTap }: any) {
  const t = COMPACT_TONE[tone] || COMPACT_TONE.primary
  // V3-SYSTEM-1B-1: subline mutes when the metric is zero. Three tiles
  // at zero used to read as three colored shouts; now they read as
  // three quiet captions and only nonzero counts wear their tone.
  const isZero = value != null && Number(value) === 0
  const sublineColor = isZero ? 'var(--v3-text-muted)' : t.color

  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        position: 'relative',
        textAlign: 'left',
        // V3-SYSTEM-1B-1: tile pad 14/12/12 → 12/12/10, radius 14 → 12,
        // minHeight 88 → 72 so the three KPIs read as a quiet strip.
        padding: '12px 12px 12px',
        borderRadius: 10,
        // Lifted-panel treatment: top-lit gradient + layered shadow so
        // the KPI tiles match the Jobs/Home card depth pass instead of
        // reading as flat squares.
        background: 'linear-gradient(180deg, var(--v3-surface-2) 0%, var(--v3-surface) 70%)',
        border: '1px solid var(--v3-border)',
        boxShadow: '0 1px 0 rgba(242, 237, 228, 0.05) inset, 0 1px 2px rgba(20, 20, 20, 0.36), 0 6px 16px rgba(20, 20, 20, 0.30)',
        color: 'var(--v3-text)',
        cursor: 'pointer',
        minHeight: 72,
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* V3-HOME-1: no colored top-edge bar. Tone signaled only via the
          icon chip + value color. Chip + value sizes shrunk in 1B-1. */}

      {Icon ? (
        <span aria-hidden="true" style={{
          display: 'inline-grid', placeItems: 'center',
          width: 24, height: 24, borderRadius: 10,
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border-strong)',
          color: t.color,
          marginBottom: 8
        }}>
          <Icon size={13} strokeWidth={2.2} />
        </span>
      ) : null}

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20,
        color: t.color,
        lineHeight: 1,
        marginBottom: 6,
        minHeight: 22,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value == null ? (
          <span className="v3-skeleton" style={{ width: 40, height: 18, borderRadius: 10 }} />
        ) : isMoney ? (
          <>
            <span style={{
              fontSize: 12, color: 'var(--v3-text-muted)',
              verticalAlign: 'top', marginRight: 1
            }}>
              $
            </span>
            <CountUp
              to={Number(value) || 0}
              formatter={(n) => {
                if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
                return n.toLocaleString()
              }}
            />
          </>
        ) : (
          <CountUp to={Number(value) || 0} />
        )}
      </div>

      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--v3-text)',
        lineHeight: 1.3,
        letterSpacing: 0
      }}>
        {label}
      </div>

      {subline ? (
        <div style={{
          marginTop: 3,
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          // V3-SYSTEM-1B-1: subline weight 700 → 500 so the row carries
          // less shout. Three tiles in a row read as quiet captions; only
          // the icon chip + value digit carry the tone-color load.
          fontWeight: 500,
          color: sublineColor,
          fontVariantNumeric: 'tabular-nums'
        }}>
          {subline}
        </div>
      ) : null}
    </motion.button>
  )
}

/* ============================================================
   NextActionRow, per-job CTA shown in the Next Actions section.
   Icon + tone driven by `kind`. Gold left-edge accent; flat row
   that hover-lifts to invite the tap.
   ============================================================ */

// Per-kind icon. The urgency tone (danger/warn/success) drives the row's
// accent color via URGENCY_TONE below, kind alone no longer picks color
// (an old lead can be warn OR danger depending on how cold it's gone).
const NEXT_ACTION_KIND: Record<string, any> = {
  followup:   { Icon: PhoneCall },
  'followup-due': { Icon: PhoneCall },
  'viewed-quiet': { Icon: PhoneCall },
  'quote-changes': { Icon: PenLine },
  reschedule: { Icon: CalendarClock },
  invoice:    { Icon: Receipt },
  'inv-overdue': { Icon: Receipt },
  'co-unsigned': { Icon: FileText }
}

function jobActionPath(contactId: any, tab?: any, intent?: any) {
  if (!contactId) return '/jobs'
  const params = new URLSearchParams()
  if (tab) params.set('tab', String(tab))
  if (intent) params.set('action', String(intent))
  const query = params.toString()
  return `/jobs/${contactId}${query ? `?${query}` : ''}`
}

function pipelineDetailPath(deal: any) {
  // Canonical mapping in stages.ts; Home opts collectable rows
  // (invoice-stage / work-complete) onto the financials tab.
  const stage = String(deal?.stage || '').toLowerCase()
  return detailRoute(deal, { financials: stage === 'invoice' || !!deal?.completed_at })
}

function nextActionPath(action: any) {
  if (!action?.contactId) return '/jobs'
  return jobActionPath(action.contactId, action.tab, action.intent)
}

// V3-SYSTEM-1B-1: warn no longer uses brand gold (--v3-primary). Stale
// leads <14d cold now wear the dedicated --v3-warn amber (#C9963A) so
// gold can stay scarce on Home, reserved for the Pipeline money digits
// and the small hairline sweep. Red urgency stays red, green stays green.
const URGENCY_TONE: Record<string, any> = {
  danger:  { color: 'var(--v3-danger-bright)',  glow: 'rgba(192, 57, 43, 0.45)' },
  warn:    { color: 'var(--v3-warn)',           glow: 'rgba(201, 150, 58, 0.40)' },
  success: { color: 'var(--v3-success-bright)', glow: 'rgba(45, 122, 79, 0.40)' }
}

function NextActionRow({ action, photoUrl, onTap }: any) {
  const kindMeta = NEXT_ACTION_KIND[action.kind] || { Icon: Zap }
  const { Icon } = kindMeta
  const tone = URGENCY_TONE[action.urgencyTone] || URGENCY_TONE.warn

  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.97 }}
      // Hover: lift + shift right 2px + brighter surface. Reads as a
      // control being depressed/highlighted. Hex literal so framer can
      // interpolate the colour smoothly (matches --v3-surface-2 token).
      whileHover={{
        y: -2,
        x: 2,
        backgroundColor: 'var(--v3-surface-3)'
      }}
      // Snappier spring (stiffness 720 / damping 26) so tap + hover both
      // read as immediate key-presses, not soft squishes.
      transition={{ type: 'spring', stiffness: 720, damping: 26 }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        // V3-HOME-2: row pad 9/12/9/14 → 8/12/8/14, saves ~10px stacked
        // across 5 rows. Tap target stays comfortable (icon + title
        // text already span ~36px tall before the row padding).
        padding: '8px 12px 8px 12px',
        borderRadius: 10,
        // Subtle linear top-light overlay + slightly raised surface mix
        // so each row reads as a metal plate, not a list item.
        background: `
          linear-gradient(180deg, var(--v3-glass-tint), transparent 40%),
          var(--v3-surface)
        `,
        border: '1px solid var(--v3-border-strong)',
        boxShadow: 'inset 0 1px 0 var(--v3-glass-tint-2), 0 1px 2px rgba(20, 20, 20, 0.25)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        width: '100%',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* Left edge accent, urgency-tone color + matching glow. THIS is the
          critical-vs-optional signal. Operator scan: red bar = drop everything,
          amber = today, green = money in motion. V3-SYSTEM-1B-1: glow blur
          softened 12 → 8 so the spine reads as a hairline cue, not a halo. */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0, top: 7, bottom: 7,
        width: 3,
        background: tone.color,
        borderRadius: '0 3px 3px 0',
        boxShadow: `0 0 8px ${tone.glow}`
      }} />

      {/* V3-SYSTEM-1B-3: when a real cover photo exists for the linked
          contact, show it instead of the kind-of-action icon chip. The
          row title already names the action ("Follow up with Jane"), so
          a photo telegraphs "this is about Jane's job", a stronger
          object cue than a generic phone glyph. Without a photo, the
          existing tone-keyed icon chip stays as the kind cue. */}
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 10,
            objectFit: 'cover',
            background: 'var(--v3-surface-2)',
            border: '1px solid var(--v3-border-strong)',
            display: 'block'
          }}
          onError={(e) => {
            // Signed URL expired or blocked, hide so the broken-image
            // glyph doesn't show. Space stays reserved.
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
      ) : (
        <span aria-hidden="true" style={{
          flexShrink: 0,
          width: 32, height: 32,
          borderRadius: 10,
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border-strong)',
          color: tone.color,
          display: 'grid',
          placeItems: 'center'
        }}>
          <Icon size={14} />
        </span>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--v3-text)',
          letterSpacing: 0,
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {action.title}
        </div>
        <div style={{
          marginTop: 1,
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          lineHeight: 1.3,
          color: 'var(--v3-text-muted)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {action.detail}
        </div>
      </div>

      {/* Urgency chip, short label that names the urgency in plain words.
          Color matches the spine. */}
      {action.urgencyLabel && (
        <StatusPill
          color={tone.color}
          label={action.urgencyLabel}
          style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
        />
      )}

      <ChevronRight size={14} color="var(--v3-text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}

/* ============================================================
   RowThumb, V3-SYSTEM-1B-3.
   32×32 cover-photo tile used by Today on Site rows + Pipeline
   Preview rows. Renders a real signed-URL image when one exists,
   otherwise a neutral surface-2 + hairline tile with 1-2 letter
   initials in muted ink. No gold tint, no stage tint, no fake
   placeholder image, restraint is intentional so the row's
   spine + stage label + amount stay the carriers of meaning.
   ============================================================ */
function RowThumb({ photoUrl, name, size = 32 }: any) {
  const radius = 8
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        loading="lazy"
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'cover',
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border)',
          display: 'block'
        }}
        onError={(e) => {
          // Signed URL 403 / network failure, hide rather than show
          // a broken-image glyph. The tile space stays reserved so the
          // row layout doesn't shift; next data refresh restores it.
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: radius,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text-muted)',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: size >= 36 ? 14 : 12,
        letterSpacing: 0,
        lineHeight: 1
      }}
    >
      {nameInitials(name)}
    </span>
  )
}

function nameInitials(name: any) {
  if (!name) return '·'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/* StageChip, inline "<count> <label>" tap target inside the pipeline
   card breakdown. stopPropagation so the outer card tap (→ /jobs)
   doesn't double-fire when one of the chips is pressed. */
/* ============================================================
   PipelineBreakdownCell, one tap-cell inside the pipeline hero's
   3-up breakdown row. Ported from the v3 design's
   pipeline-hero__breakdown (screens-home.jsx .brk pattern).

   Layout:
     ● Label
     $stamp value
     N segments
   ============================================================ */
function PipelineBreakdownCell({ dotColor, label, count, tone, onClick }: any) {
  const valueColor = tone === 'success'
    ? 'var(--v3-success-bright, #5C5C5C)'
    : tone === 'gold'
      ? 'var(--v3-primary)'
      : 'var(--v3-text)'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0
      }}
    >
      <Eyebrow as="div">
        <span aria-hidden="true" style={{
          width: 8, height: 8, borderRadius: 10,
          background: dotColor,
          boxShadow: `0 0 8px ${dotColor}`
        }} />
        {label}
      </Eyebrow>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20,
        lineHeight: 1,
        color: valueColor,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: 0
      }}>
        {count}
      </div>
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--v3-text-muted)',
        letterSpacing: 0
      }}>
        {count === 1 ? 'deal' : 'deals'}
      </div>
    </button>
  )
}

function StageChip({ count, label, stage, navigate }: any) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        hapticTap()
        navigate(`/jobs?stage=${stage}`)
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        padding: '4px 4px',
        margin: '-2px -4px',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <span style={{ fontWeight: 700, color: 'var(--v3-text)' }}>{count}</span>
      <span>{label}</span>
    </button>
  )
}
