// Sunrise and sunset for a place and a calendar day, computed on the
// device so the Auto theme works offline and costs no request.
//
// The sunrise equation as NOAA and most almanacs use it (the form on
// Wikipedia's "Sunrise equation" page): mean solar anomaly, equation of
// center, ecliptic longitude, solar transit, declination, then the hour
// angle at which the sun's upper limb meets the horizon, with 0.833
// degrees for refraction and the sun's radius. Accurate to about a
// minute at the latitudes contractors work in, which is plenty for
// switching a theme. sunTimes.test.ts checks it against Open-Meteo.

const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const J2000_MIDNIGHT_UTC = Date.UTC(2000, 0, 1)
const UNIX_EPOCH_JD = 2440587.5

export type SunWindow =
  | { kind: 'normal'; sunrise: number; sunset: number }
  | { kind: 'polar-day' }
  | { kind: 'polar-night' }

function julianToMs(jd: number) {
  return (jd - UNIX_EPOCH_JD) * DAY_MS
}

/**
 * Sunrise and sunset, as epoch milliseconds, for the calendar day
 * `year`-`month`-`day` (month 1 to 12) at a place, east longitude
 * positive. The day is the place's own calendar day: for Sydney on
 * October 10 the sunrise falls on October 9 in UTC.
 */
export function sunWindow(year: number, month: number, day: number, lat: number, lon: number): SunWindow {
  // Days from 2000-01-01 to this date; J2000 is noon on that first day,
  // so the approximate transit lands near noon at Greenwich, then the
  // longitude moves it to the place's own solar noon.
  const n = Math.round((Date.UTC(year, month - 1, day) - J2000_MIDNIGHT_UTC) / DAY_MS)
  const jStar = n - lon / 360
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const Mr = M * RAD
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr)
  const lambda = ((M + C + 180 + 102.9372) % 360) * RAD
  const transit = 2451545 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda)
  const sinDec = Math.sin(lambda) * Math.sin(23.4397 * RAD)
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosOmega = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec)
  if (cosOmega > 1) return { kind: 'polar-night' }
  if (cosOmega < -1) return { kind: 'polar-day' }
  const omega = Math.acos(cosOmega) / RAD
  return {
    kind: 'normal',
    sunrise: Math.round(julianToMs(transit - omega / 360)),
    sunset: Math.round(julianToMs(transit + omega / 360))
  }
}

/** True when a latitude and longitude pair is usable. */
export function isValidLocation(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  )
}
