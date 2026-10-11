// The Today hero sentence (spec 9.2). Built in code from counts, never by
// the model, so it always matches what the screen lists below it.
//
//   day:   "Three stops." / "First pour at 7:30."
//   night: "Three stops done." / "Two things before tomorrow."
//
// Times are local, on a 12 hour clock without am or pm, as people say
// them on site. Counts are words up to ten and numerals after.

export type HeadlineStop = { startAt: string; title: string | null }
export type Headline = { title: [string, string] }

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** "Three", "Ten", "12": the start of a sentence. */
function countWord(n: number): string {
  const word = Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n] : String(n)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function counted(n: number, one: string, many: string): string {
  return `${countWord(n)} ${n === 1 ? one : many}`
}

/** "7:30", "1:15", "12:30": local time, 12 hour clock, no am or pm. */
export function clockTime(date: Date): string {
  const hours = date.getHours() % 12 || 12
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** True when the title has a word that starts with "pour", in any case. */
export function isPour(title: string | null): boolean {
  return title != null && /(^|[^a-z0-9])pour/i.test(title)
}

export function dayHeadline(stops: HeadlineStop[]): Headline {
  if (stops.length === 0) return { title: ['Clear day.', 'Nothing on the schedule.'] }
  let first: { at: number; title: string | null } | null = null
  for (const stop of stops) {
    const at = Date.parse(stop.startAt)
    if (Number.isNaN(at)) continue
    if (!first || at < first.at) first = { at, title: stop.title }
  }
  const lead = `${counted(stops.length, 'stop', 'stops')}.`
  if (!first) return { title: [lead, 'No start times yet.'] }
  const time = clockTime(new Date(first.at))
  return { title: [lead, isPour(first.title) ? `First pour at ${time}.` : `First at ${time}.`] }
}

export function nightHeadline({ stopsToday, openAnswers }: { stopsToday: number; openAnswers: number }): Headline {
  const done = stopsToday > 0 ? `${counted(stopsToday, 'stop', 'stops')} done.` : 'Quiet day.'
  const left = openAnswers > 0 ? `${counted(openAnswers, 'thing', 'things')} before tomorrow.` : 'Nothing waiting on you.'
  return { title: [done, left] }
}
