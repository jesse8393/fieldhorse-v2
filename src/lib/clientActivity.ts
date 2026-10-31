const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type ClientActivity = {
  state: 'unknown' | 'recent' | 'stale'
  lastTouch: number | null
}

/** Missing or unusable dates cannot establish either recent or stale activity. */
export function clientActivity(value: unknown, now = Date.now()): ClientActivity {
  if (typeof value !== 'string' || !value.trim()) return { state: 'unknown', lastTouch: null }
  const lastTouch = Date.parse(value)
  if (!Number.isFinite(lastTouch) || lastTouch <= 0 || lastTouch > now) {
    return { state: 'unknown', lastTouch: null }
  }
  return { state: now - lastTouch > RECENT_WINDOW_MS ? 'stale' : 'recent', lastTouch }
}
