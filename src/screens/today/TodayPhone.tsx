import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CalendarPlus,
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
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  OnyxStage,
  PhotoCard,
  Row,
  Skeleton,
  SkeletonRows,
  SyncPill
} from '../../components/fh/index.ts'
import DataErrorState from '../../components/DataErrorState.tsx'
import type { HomeDashboardBundle, HomeNextAction, HomeTodayOnSite } from '../../lib/homeDashboard.ts'
import { detailRoute } from '../../lib/stages.ts'
import {
  answerCopy,
  buildTodayView,
  navigateHref,
  stopTime,
  todayWeather,
  tomorrowLine
} from '../../lib/todayView.ts'
import './today.css'

// Today on a phone (spec 9.2, renders glamor/g-today.jpg and
// base/night.jpg). One onyx stage that runs under the header with the
// date, the hero sentence and the weather; the next stop on a photo card
// overlapping its edge; then hairline lists on plaster: what needs an
// answer and the day. After sunset at the company's location the same
// screen turns to the evening: today, done, and tomorrow.
//
// Everything shown comes from buildTodayView (lib/todayView.ts); this
// file only lays it out.

type TodayPhoneProps = {
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

// v3-screen is the screen root hook the shell and its tests look for.
const ROOT = 'fht v3-screen v3-screen--today'

/* ---------------- Header over the stage ---------------- */

type HeaderMode = 'top' | 'stage' | 'page'

// The shared header is sticky with a plaster veil. While it sits over
// the stage it turns clear (at the top) or onyx (scrolled inside the
// stage) with linen icons; past the stage it is its usual self.
// today.css reads this through data-header on the screen root.
function useHeaderOverStage(stageRef: RefObject<HTMLElement | null>): HeaderMode {
  const [mode, setMode] = useState<HeaderMode>('top')
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const stage = stageRef.current
      const header = document.querySelector('.fhs-header')
      if (!stage || !header) return
      const next: HeaderMode = window.scrollY <= 2
        ? 'top'
        : stage.getBoundingClientRect().bottom > header.getBoundingClientRect().bottom ? 'stage' : 'page'
      setMode(next)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [stageRef])
  return mode
}

/* ---------------- Small pieces ---------------- */

function skyIcon(code: number | null | undefined): LucideIcon {
  if (code == null) return Cloud
  if (code <= 1) return Sun
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow
  if (code >= 95) return CloudLightning
  return Cloud
}

function longDate(now: Date) {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function eveningDate(now: Date) {
  const time = stopTime(now.toISOString())
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  return time ? `${weekday}, ${time.time} ${time.suffix}` : weekday
}

function SectionHead({ id, title, end, link = false }: { id: string; title: string; end?: ReactNode; link?: boolean }) {
  return (
    <div className="fht-head">
      <h2 id={id} className="fht-head__title">{title}</h2>
      {end != null && <div className={`fht-head__end${link ? ' fht-head__end--link' : ''}`}>{end}</div>}
    </div>
  )
}

function WeekLink() {
  return <Button variant="quiet" size="mini" to="/schedule">Week</Button>
}

function stageChip(stage: string | null) {
  if (stage === 'lead') return <Chip label="Lead" />
  if (stage === 'quote') return <Chip label="Quote" />
  return null
}

/** The job name, and what happens there, for a visit row. */
function visitText(item: HomeTodayOnSite): { name: string; detail: string | null } {
  const name = item.clientName || item.title
  const detail = item.clientName && item.title !== item.clientName ? item.title : item.jobTitle
  return { name, detail: detail || null }
}

type VisitVariant = 'day' | 'done' | 'tomorrow'

function Visit({ item, variant, over, maps }: { item: HomeTodayOnSite; variant: VisitVariant; over: boolean; maps: (address: string) => string }) {
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

/* ---------------- Screen ---------------- */

export default function TodayPhone({
  bundle,
  loading,
  error,
  onRetry,
  now,
  lat,
  lon,
  services,
  forecast,
  forecastError,
  hasLocation,
  onPinLocation,
  actionPath
}: TodayPhoneProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const headerMode = useHeaderOverStage(stageRef)
  const [params] = useSearchParams()
  const showAllAnswers = params.get('answers') === 'all'

  const weather = hasLocation ? todayWeather(forecast, services) : null
  const view = bundle ? buildTodayView({ bundle, now, lat, lon, weather }) : null
  const evening = view?.evening ?? false

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0
  const maps = (address: string) => navigateHref(address, userAgent, touchPoints)

  /* ----- Stage ----- */
  let stageLine: ReactNode = null
  if (view?.evening) {
    stageLine = (
      <p className="fht-line">
        <Icon icon={Moon} size={22} />
        <span>{tomorrowLine(view.tomorrow, hasLocation ? forecast : null)}</span>
      </p>
    )
  } else if (!hasLocation) {
    stageLine = (
      <div className="fht-line fht-line--pin">
        <Button variant="secondary" size="mini" icon={LocateFixed} onClick={onPinLocation}>
          Use my location for the forecast
        </Button>
        {forecastError && <span className="fht-line__note" role="status">{forecastError}</span>}
      </div>
    )
  } else if (view?.weatherLine) {
    stageLine = (
      <p className="fht-line">
        <Icon icon={skyIcon(weather?.code)} size={22} />
        <span>{view.weatherLine}</span>
      </p>
    )
  } else if (forecastError) {
    stageLine = <p className="fht-line fht-line--quiet">Forecast unavailable right now.</p>
  } else if (forecast == null && (view || loading)) {
    // The forecast is still on its way.
    stageLine = (
      <p className="fht-line" aria-hidden="true">
        <Skeleton width="78%" height={14} />
      </p>
    )
  }

  const stage = (
    <div ref={stageRef} className="fht-stagewrap">
      <OnyxStage glow className="fht-stage" aria-labelledby="fht-title">
        <div className="fht-stage__meta">
          <p className="fht-date">{evening ? eveningDate(now) : longDate(now)}</p>
          <SyncPill />
        </div>
        {view ? (
          <h1 id="fht-title" className="fht-hero">
            <span className="fht-hero__line">{view.title[0]}</span>{' '}
            <span className="fht-hero__line">{view.title[1]}</span>
          </h1>
        ) : loading ? (
          <>
            <h1 id="fht-title" className="fhc-vh">Today</h1>
            <div className="fht-hero fht-hero--loading" aria-hidden="true">
              <Skeleton width="56%" height={32} />
              <Skeleton width="80%" height={32} />
            </div>
          </>
        ) : (
          <h1 id="fht-title" className="fht-hero">Today</h1>
        )}
        {stageLine}
      </OnyxStage>
    </div>
  )

  /* ----- Loading and error with nothing cached ----- */
  if (!view) {
    return (
      <div className={`${ROOT}${loading ? ' has-card' : ''}`} data-header={headerMode}>
        {stage}
        {loading ? (
          <>
            <div className="fht-card" aria-hidden="true">
              <div className="fht-card__tray">
                <div className="fht-card__frame fh-onyx-scope">
                  <Skeleton width="40%" height={12} />
                  <Skeleton width="64%" height={22} />
                </div>
              </div>
            </div>
            <div className="fht-body">
              <SkeletonRows rows={3} label="Loading today" />
            </div>
          </>
        ) : (
          <div className="fht-body fht-body--flush">
            <DataErrorState
              title="Today could not load"
              message={error || 'Check your connection and try again.'}
              onRetry={onRetry}
            />
          </div>
        )}
      </div>
    )
  }

  /* ----- Sections ----- */
  const isOver = (item: HomeTodayOnSite) => view.done.includes(item)
  const next = !evening ? view.nextStop : null
  const nextTime = next ? stopTime(next.startAt) : null
  const answers = showAllAnswers ? bundle?.nextActions ?? view.answers : view.answers

  const nextCard = next && (
    <section className="fht-card fht-next" aria-label="Next stop">
      {(() => {
        const shared = {
          eyebrow: nextTime ? `Next stop, ${nextTime.time} ${nextTime.suffix}` : 'Next stop',
          title: (
            <Link className="fht-next__link" to={`/jobs/${next.jobId}`}>
              {next.title}
            </Link>
          ),
          titleAs: 'p' as const,
          eager: true,
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
        return next.photoUrl
          ? <PhotoCard {...shared} src={next.photoUrl} alt={`Latest photo from ${next.title}`} />
          : <PhotoCard {...shared} />
      })()}
    </section>
  )

  const answersSection = view.answersTotal > 0 && (
    <section className="fht-section fht-section--answers" aria-labelledby="fht-answers">
      <SectionHead id="fht-answers" title="Needs an answer" end={<span className="fht-head__count">{view.answersTotal}</span>} />
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
      {view.answersTotal > 3 && (
        <div className="fht-more">
          <Button variant="quiet" size="mini" to={{ search: showAllAnswers ? '' : '?answers=all' }} replace>
            {showAllAnswers ? 'Show fewer' : 'See all'}
          </Button>
        </div>
      )}
    </section>
  )

  let daySections: ReactNode
  if (evening) {
    daySections = (
      <>
        {view.day.length > 0 && (
          <section className="fht-section" aria-labelledby="fht-done">
            <SectionHead
              id="fht-done"
              title="Today, done"
              end={<span className="fht-head__count">{`${view.done.length} of ${view.day.length}`}</span>}
            />
            <ul className="fht-list">
              {view.day.map((item) => <Visit key={item.id} item={item} variant="done" over={isOver(item)} maps={maps} />)}
            </ul>
          </section>
        )}
        <section className="fht-section" aria-labelledby="fht-tomorrow">
          <SectionHead id="fht-tomorrow" title="Tomorrow" end={<WeekLink />} link />
          {view.tomorrow.length > 0 ? (
            <ul className="fht-list">
              {view.tomorrow.map((item) => <Visit key={item.id} item={item} variant="tomorrow" over={false} maps={maps} />)}
            </ul>
          ) : (
            <p className="fht-quiet">Nothing on the schedule tomorrow.</p>
          )}
        </section>
      </>
    )
  } else if (view.day.length > 0) {
    daySections = (
      <section className="fht-section" aria-labelledby="fht-day">
        <SectionHead id="fht-day" title="Your day" end={<WeekLink />} link />
        <ul className="fht-list">
          {view.day.map((item) => <Visit key={item.id} item={item} variant="day" over={isOver(item)} maps={maps} />)}
        </ul>
      </section>
    )
  } else {
    daySections = (
      <EmptyState
        className="fht-empty"
        icon={CalendarPlus}
        title="Nothing scheduled today"
        action={<Button variant="primary" to="/schedule">Plan the week</Button>}
      />
    )
  }

  return (
    <div className={`${ROOT}${next ? ' has-card' : ''}`} data-header={headerMode}>
      {stage}
      {nextCard}
      <div className="fht-body">
        {error && (
          <DataErrorState compact title="Today could not refresh" message={error} onRetry={onRetry} />
        )}
        {answersSection}
        {daySections}
      </div>
    </div>
  )
}
