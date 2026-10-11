import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarPlus } from 'lucide-react'
import {
  Button,
  EmptyState,
  OnyxStage,
  Skeleton,
  SkeletonRows,
  SyncPill
} from '../../components/fh/index.ts'
import DataErrorState from '../../components/DataErrorState.tsx'
import type { HomeTodayOnSite } from '../../lib/homeDashboard.ts'
import { buildTodayView, todayWeather } from '../../lib/todayView.ts'
import type { TodayScreenProps } from './todayParts.tsx'
import {
  AnswerList,
  NextStopCard,
  SectionHead,
  StageHero,
  StageLine,
  Visit,
  WeekLink,
  deviceMaps,
  eveningDate,
  longDate
} from './todayParts.tsx'
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

type TodayPhoneProps = TodayScreenProps

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

  const maps = deviceMaps()

  const stage = (
    <div ref={stageRef} className="fht-stagewrap">
      <OnyxStage glow className="fht-stage" aria-labelledby="fht-title">
        <div className="fht-stage__meta">
          <p className="fht-date">{evening ? eveningDate(now) : longDate(now)}</p>
          <SyncPill />
        </div>
        <StageHero view={view} loading={loading} />
        <StageLine
          view={view}
          loading={loading}
          hasLocation={hasLocation}
          forecast={forecast}
          forecastError={forecastError}
          weather={weather}
          onPinLocation={onPinLocation}
        />
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
  const answers = showAllAnswers ? bundle?.nextActions ?? view.answers : view.answers

  const nextCard = next && <NextStopCard next={next} maps={maps} />

  const answersSection = view.answersTotal > 0 && (
    <section className="fht-section fht-section--answers" aria-labelledby="fht-answers">
      <SectionHead id="fht-answers" title="Needs an answer" end={<span className="fht-head__count">{view.answersTotal}</span>} />
      <AnswerList answers={answers} now={now} actionPath={actionPath} />
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
