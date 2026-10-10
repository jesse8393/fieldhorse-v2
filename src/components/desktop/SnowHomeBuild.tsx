// SnowHomeBuild, desktop Today (spec 9.2 and the Phase 4 plan, Task 4.5).
// There is no desktop render; it is the phone Today laid out for a wide
// screen, from the same buildTodayView.
//
// Left column: the onyx stage (date line, headline, weather and pour line,
// the gold hairline) with the next stop on a photo card hanging off its
// edge, then "Your day". Right column: "Needs an answer" and the week strip,
// seven days with their visits, today marked, each opening the schedule.
// After sunset the left column turns to "Today, done" and "Tomorrow".
//
// The dashboard tiles, the revenue overview and the pipeline tables are
// not on Today any more; pipeline numbers live in Reports (/analytics).
// There is no brushed gold action on a full day, as on the phone: New lead
// and New job are secondary buttons on the stage.

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarPlus, Plus } from 'lucide-react'
import { Button, EmptyState, OnyxStage, Skeleton, SkeletonRows, SyncPill } from '../fh/index.ts'
import DataErrorState from '../DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useScheduleEvents } from '../../lib/queries.ts'
import { weekRangeLabel } from '../../lib/scheduleBoard.ts'
import { buildTodayView, todayWeather, weekBounds, weekStrip } from '../../lib/todayView.ts'
import type { HomeTodayOnSite } from '../../lib/homeDashboard.ts'
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
} from '../../screens/today/todayParts.tsx'
import type { TodayScreenProps } from '../../screens/today/todayParts.tsx'
import '../../screens/today/today.css'
import './today-desktop.css'

/* ---------------- The week strip ---------------- */

function WeekSection({ now }: { now: Date }) {
  const { user } = useAuth()
  const { start, end } = weekBounds(now)
  const week = useScheduleEvents(user?.id, start.toISOString(), end.toISOString())
  const days = useMemo(() => weekStrip(week.data ?? [], now), [week.data, now])
  const last = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)

  return (
    <section className="fht-section fhtd-week" aria-labelledby="fhtd-week">
      <SectionHead
        id="fhtd-week"
        title="This week"
        end={<span className="fht-head__count">{weekRangeLabel(start, last)}</span>}
      />
      {week.data ? (
        <ol className="fhtd-week__strip">
          {days.map((day) => (
            <li key={day.key} className={`fhtd-day${day.today ? ' is-today' : ''}${day.count === 0 ? ' is-empty' : ''}`}>
              <Link
                className="fhtd-day__link"
                to={`/schedule?d=${day.key}`}
                aria-label={day.label}
                aria-current={day.today ? 'date' : undefined}
              >
                <span className="fhtd-day__week">
                  {day.today && <span className="fhtd-day__dot" aria-hidden="true" />}
                  {day.today ? 'Today' : day.weekday}
                </span>
                <span className="fhtd-day__num">{day.dayOfMonth}</span>
                <span className="fhtd-day__count">{day.countText}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : week.isError ? (
        <p className="fht-quiet">
          The week could not load. <Link className="fhtd-inline-link" to="/schedule">Open the schedule</Link>
        </p>
      ) : (
        <ol className="fhtd-week__strip" aria-busy="true" aria-label="Loading the week">
          {days.map((day) => (
            <li key={day.key} className="fhtd-day">
              <span className="fhtd-day__link" aria-hidden="true">
                <Skeleton width={28} height={12} />
                <Skeleton width={20} height={22} />
                <Skeleton width={36} height={12} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/* ---------------- Screen ---------------- */

export default function SnowHomeBuild({
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
}: TodayScreenProps) {
  const [params] = useSearchParams()
  const showAllAnswers = params.get('answers') === 'all'

  const weather = hasLocation ? todayWeather(forecast, services) : null
  const view = bundle ? buildTodayView({ bundle, now, lat, lon, weather }) : null
  const evening = view?.evening ?? false
  const maps = deviceMaps()

  const next = view && !evening ? view.nextStop : null
  const hasCard = next != null || (!view && loading)

  /* ----- Stage ----- */
  const stage = (
    <OnyxStage glow className="fhtd-stage" aria-labelledby="fht-title">
      <div className="fht-stage__meta">
        <p className="fht-date">{evening ? eveningDate(now) : longDate(now)}</p>
        <div className="fhtd-stage__tools">
          <SyncPill />
          <Button variant="secondary" size="mini" icon={Plus} to="/work?new=1">New lead</Button>
          <Button variant="secondary" size="mini" icon={Plus} to="/work?new=1&asStage=job">New job</Button>
        </div>
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
  )

  /* ----- Right column ----- */
  let answersSection
  if (view) {
    const answers = showAllAnswers ? bundle?.nextActions ?? view.answers : view.answers
    answersSection = (
      <section className="fht-section fht-section--answers" aria-labelledby="fht-answers">
        <SectionHead id="fht-answers" title="Needs an answer" end={<span className="fht-head__count">{view.answersTotal}</span>} />
        {view.answersTotal > 0 ? (
          <AnswerList answers={answers} now={now} actionPath={actionPath} />
        ) : (
          <p className="fht-quiet">Nothing needs an answer right now.</p>
        )}
        {view.answersTotal > 3 && (
          <div className="fht-more">
            <Button variant="quiet" size="mini" to={{ search: showAllAnswers ? '' : '?answers=all' }} replace>
              {showAllAnswers ? 'Show fewer' : 'See all'}
            </Button>
          </div>
        )}
      </section>
    )
  } else if (loading) {
    answersSection = (
      <section className="fht-section" aria-hidden="true">
        <SkeletonRows rows={3} label="Loading what needs an answer" />
      </section>
    )
  }

  const side = (
    <div className="fhtd-side">
      {answersSection}
      <WeekSection now={now} />
    </div>
  )

  /* ----- Loading and error with nothing cached ----- */
  if (!view) {
    return (
      <div className={`fhtd fh-build-page${hasCard ? ' has-card' : ''}`} data-build-screen="SnowHomeBuild" data-build-route="/">
        <div className="fhtd-grid">
          <div className="fhtd-main">
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
                <SkeletonRows rows={3} label="Loading today" />
              </>
            ) : (
              <DataErrorState
                title="Today could not load"
                message={error || 'Check your connection and try again.'}
                onRetry={onRetry}
              />
            )}
          </div>
          {side}
        </div>
      </div>
    )
  }

  /* ----- Left column sections ----- */
  const isOver = (item: HomeTodayOnSite) => view.done.includes(item)

  let daySections
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
        className="fhtd-empty"
        icon={CalendarPlus}
        title="Nothing scheduled today"
        action={<Button variant="primary" to="/schedule">Plan the week</Button>}
      />
    )
  }

  return (
    <div className={`fhtd fh-build-page${next ? ' has-card' : ''}`} data-build-screen="SnowHomeBuild" data-build-route="/">
      {error && (
        <DataErrorState compact className="fhtd-error" title="Today could not refresh" message={error} onRetry={onRetry} />
      )}
      <div className="fhtd-grid">
        <div className="fhtd-main">
          {stage}
          {next && <NextStopCard next={next} maps={maps} ratio="21 / 8" />}
          {daySections}
        </div>
        {side}
      </div>
    </div>
  )
}
