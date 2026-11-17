// A destructive action confirms in place with a second tap on the same
// button within 4 seconds (SPEC D57). No sheet, no dialog: the first tap
// arms the button and changes its label to "Tap again to ...", the second
// runs the action, and the button goes back to resting on its own when
// the second tap does not come.

import { useCallback, useEffect, useRef, useState } from 'react'

export const SECOND_TAP_MS = 4000

/**
 * A second tap sooner than this after arming is part of the same double
 * tap (or a bounce), not a decision, so it is ignored and the button stays
 * armed.
 */
export const SECOND_TAP_MIN_MS = 500

/** What a tap does, given when the button was armed (null when resting). */
export function secondTapStep(armedAt: number | null, now: number, minMs: number = SECOND_TAP_MIN_MS): 'arm' | 'ignore' | 'run' {
  if (armedAt == null) return 'arm'
  return now - armedAt < minMs ? 'ignore' : 'run'
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** One armed button. `tap(run)` arms on the first call and runs on the second. */
export function useSecondTap(ms: number = SECOND_TAP_MS) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedAt = useRef<number | null>(null)

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    armedAt.current = null
    setArmed(false)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const tap = useCallback((run: () => void): boolean => {
    // Read the ref, not state: two taps can land before a re-render.
    const step = secondTapStep(armed ? armedAt.current : null, clock())
    if (step === 'ignore') return false
    if (step === 'run') {
      disarm()
      run()
      return true
    }
    armedAt.current = clock()
    setArmed(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; armedAt.current = null; setArmed(false) }, ms)
    return false
  }, [armed, disarm, ms])

  return { armed, tap, disarm }
}

/**
 * One armed row in a list. `tap(id, run)` arms that row's button on the
 * first call and runs on the second; arming another row disarms the first.
 */
export function useArmedId(ms: number = SECOND_TAP_MS) {
  const [armedId, setArmedId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedAt = useRef<number | null>(null)

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    armedAt.current = null
    setArmedId(null)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const tap = useCallback((id: string, run: () => void): boolean => {
    const step = secondTapStep(armedId === id ? armedAt.current : null, clock())
    if (step === 'ignore') return false
    if (step === 'run') {
      disarm()
      run()
      return true
    }
    if (timer.current) clearTimeout(timer.current)
    armedAt.current = clock()
    setArmedId(id)
    timer.current = setTimeout(() => { timer.current = null; armedAt.current = null; setArmedId(null) }, ms)
    return false
  }, [armedId, disarm, ms])

  return { armedId, tap, disarm }
}
