import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronRight,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  LocateFixed,
  MapPin,
  Moon,
  Sun
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button, Chip, Icon, PhotoCard, Row, Skeleton } from '../../components/fh/index.ts'
import type { HomeDashboardBundle, HomeNextAction, HomeTodayOnSite } from '../../lib/homeDashboard.ts'
import { detailRoute } from '../../lib/stages.ts'
import {
  answerCopy,
  navigateHref,
  stopTime,
  tomorrowLine
} from '../../lib/todayView.ts'
import type { TodayNextStop, TodayView, TodayWeather } from '../../lib/todayView.ts'
import './today.css'

// The pieces of Today that the phone (TodayPhone.tsx) and the desktop
// (components/desktop/SnowHomeBuild.tsx) draw the same way: the stage's
// hero and weather line, the next stop card, the answer rows and the day's
// visit rows. Each one reads only what buildTodayView (lib/todayView.ts)
// gives it; the two screens decide where they sit.

/** What Home hands the phone and the desktop Today alike. */
export type TodayScreenProps = {
  bundle: HomeDashboardBundle | undefined
  loading: boolean
  /** Why the dashboard could not refresh, or empty. */
  error: string
  onRetry: () => void
  now: Date
  lat?: number | null
  lon?: number | null
  services?: string[] | null
  /** getWeather's Open Meteo response, or null while it loads. */
  forecast: unknown
  forecastError: string
  hasLocation: boolean
  onPinLocation: () => void
  /** The job page link for a next action, at the right tab and intent. */
  actionPath: (action: HomeNextAction) => string
}

/* ---------------- Small pieces ---------------- */

export function skyIcon(code: number | null | undefined): LucideIcon {
  if (code == null) return Cloud
  if (code <= 1) return Sun
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow
  if (code >= 95) return CloudLightning
  return Cloud
}

export function longDate(now: Date) {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function eveningDate(now: Date) {
  const time = stopTime(now.toISOString())
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  return time ? `${weekday}, ${time.time} ${time.suffix}` : weekday
}

export function SectionHead({ id, title, end, link = false }: { id: string; title: string; end?: ReactNode; link?: boolean }) {
  return (
    <div className="fht-head">
      <h2 id={id} className="fht-head__title">{title}</h2>
      {end != null && <div className={`fht-head__end${link ? ' fht-head__end--link' : ''}`}>{end}</div>}
    </div>
  )
}

export function WeekLink() {
  return <Button variant="quiet" size="mini" to="/schedule">Week</Button>
}

function stageChip(stage: string | null) {
  if (stage === 'lead') return <Chip label="Lead" />
  if (stage === 'quote') return <Chip label="Quote" />
  return null
}

/** Directions for an address: Apple Maps on iPhone and iPad, Google Maps elsewhere. */
export function deviceMaps() {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0
  return (address: string) => navigateHref(address, userAgent, touchPoints)
}

/* ---------------- Stage ---------------- */

/** The hero sentence, or its loading shape, or plain "Today" when nothing could load. */
export function StageHero({ view, loading }: { view: TodayView | null; loading: boolean }) {
  if (view) {
    return (
      <h1 id="fht-title" className="fht-hero">
        <span className="fht-hero__line">{view.title[0]}</span>{' '}
        <span className="fht-hero__line">{view.title[1]}</span>
      </h1>
    )
  }
  if (loading) {
    return (
      <>
        <h1 id="fht-title" className="fhc-vh">Today</h1>
        <div className="fht-hero fht-hero--loading" aria-hidden="true">
          <Skeleton width="56%" height={32} />
          <Skeleton width="80%" height={32} />
        </div>
      </>
    )
  }
  return <h1 id="fht-title" className="fht-hero">Today</h1>
}

type StageLineProps = {
  view: TodayView | null
  loading: boolean
  hasLocation: boolean
  /** getWeather's Open Meteo response, or null while it loads. */
  forecast: unknown
  forecastError: string
  weather: TodayWeather | null
  onPinLocation: () => void
}

/**
 * The line under the hero: tomorrow in the evening, the forecast prompt
 * with no location, the weather and work window, or the forecast on its way.
 */
export function StageLine({ view, loading, hasLocation, forecast, forecastError, weather, onPinLocation }: StageLineProps) {
  if (view?.evening) {
    return (
      <p className="fht-line">
        <Icon icon={Moon} size={22} />
        <span>{tomorrowLine(view.tomorrow, hasLocation ? forecast : null)}</span>
      </p>
    )
  }
  if (!hasLocation) {
    return (
      <div className="fht-line fht-line--pin">
        <Button variant="secondary" size="mini" icon={LocateFixed} onClick={onPinLocation}>
          Use my location for the forecast
        </Button>
        {forecastError && <span className="fht-line__note" role="status">{forecastError}</span>}
      </div>
    )
  }
  if (view?.weatherLine) {
    return (
      <p className="fht-line">
        <Icon icon={skyIcon(weather?.code)} size={22} />
        <span>{view.weatherLine}</span>
      </p>
    )
  }
  if (forecastError) {
    return <p className="fht-line fht-line--quiet">Forecast unavailable right now.</p>
  }
  if (forecast == null && (view || loading)) {
    // The forecast is still on its way.
    return (
      <p className="fht-line" aria-hidden="true">
        <Skeleton width="78%" height={14} />
      </p>
    )
  }
  return null
}

/* ---------------- Next stop ---------------- */

export function NextStopCard({ next, maps, ratio }: { next: TodayNextStop; maps: (address: string) => string; ratio?: string }) {
  const time = stopTime(next.startAt)
  const shared = {
    eyebrow: time ? `Next stop, ${time.time} ${time.suffix}` : 'Next stop',
    title: (
      <Link className="fht-next__link" to={`/jobs/${next.jobId}`}>
        {next.title}
      </Link>
    ),
    titleAs: 'p' as const,
    eager: true,
    ...(ratio ? { ratio } : {}),
    action: next.address ? (
      <Button
        variant="secondary"
        href={maps(next.address)}
        target="_blank"
        rel="noopener noreferrer"
        trailingIcon={ArrowRight}
      >
        Navigate
      </Button>
    ) : undefined
  }
  return (
    <section className="fht-card fht-next" aria-label="Next stop">
      {next.photoUrl
        ? <PhotoCard {...shared} src={next.photoUrl} alt={`Latest photo from ${next.title}`} />
        : <PhotoCard {...shared} />}
    </section>
  )
}

/* ---------------- Needs an answer ---------------- */

/** One Row per action: dot, title, subline and the one mini action. */
export function AnswerList({ answers, now, actionPath }: { answers: HomeNextAction[]; now: Date; actionPath: (action: HomeNextAction) => string }) {
  return (
    <ul className="fht-list">
      {answers.map((action) => {
        const copy = answerCopy(action, now)
        const path = actionPath(action)
        return (
          <Row
            key={action.id}
            as="li"
            to={path}
            dot={copy.dot}
            title={copy.title}
            subline={copy.subline}
            action={
              <Button size="mini" to={path} aria-label={`${copy.actionLabel}, ${copy.title}`}>
                {copy.actionLabel}
              </Button>
            }
          />
        )
      })}
    </ul>
  )
}

/* ---------------- The day ---------------- */

/** The job name, and what happens there, for a visit row. */
function visitText(item: HomeTodayOnSite): { name: string; detail: string | null } {
  const name = item.clientName || item.title
  const detail = item.clientName && item.title !== item.clientName ? item.title : item.jobTitle
  return { name, detail: detail || null }
}

export type VisitVariant = 'day' | 'done' | 'tomorrow'

export function Visit({ item, variant, over, maps }: { item: HomeTodayOnSite; variant: VisitVariant; over: boolean; maps: (address: string) => string }) {
  const time = stopTime(item.startAt)
  const { name, detail } = visitText(item)
  const chip = variant === 'done'
    ? (over ? <Chip tone="success" label="Done" /> : <Chip tone="info" label="Scheduled" />)
    : over ? <Chip tone="success" label="Done" /> : stageChip(item.stage)

  const body = (
    <>
      <span className="fht-visit__time">
        {time ? (
          <>
            <span className="fht-visit__clock">{time.time}</span>
            {variant !== 'done' && <span className="fht-visit__ampm">{time.suffix}</span>}
          </>
        ) : (
          <span className="fht-visit__ampm">Any time</span>
        )}
      </span>
      <span className="fht-visit__body">
        <span className="fht-visit__title">{name}</span>
        {detail && <span className="fht-visit__detail">{detail}</span>}
      </span>
      {chip && <span className="fht-visit__chip">{chip}</span>}
    </>
  )

  const address = variant === 'day' && !over ? item.address : null
  return (
    <li className={`fht-visit fht-visit--${variant}`}>
      {item.contactId ? (
        <Link className="fht-visit__main is-interactive" to={detailRoute({ id: item.contactId, stage: item.stage })}>
          {body}
        </Link>
      ) : (
        <div className="fht-visit__main">{body}</div>
      )}
      {address && (
        <div className="fht-visit__where">
          <div className="fht-visit__wherein">
            <span className="fht-visit__pin"><Icon icon={MapPin} size={18} /></span>
            <span className="fht-visit__address">{address}</span>
            <Button
              variant="quiet"
              size="mini"
              href={maps(address)}
              target="_blank"
              rel="noopener noreferrer"
              trailingIcon={ChevronRight}
              aria-label={`Navigate to ${address}`}
            >
              Navigate
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
