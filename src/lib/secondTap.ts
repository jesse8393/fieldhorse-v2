// A destructive action confirms in place with a second tap on the same
// button within 4 seconds (SPEC D57). No sheet, no dialog: the first tap
// arms the button and changes its label to "Tap again to ...", the second
// runs the action, and the button goes back to resting on its own when
// the second tap does not come.

import { useCallback, useEffect, useRef, useState } from 'react'

export const SECOND_TAP_MS = 4000

/** One armed button. `tap(run)` arms on the first call and runs on the second. */
export function useSecondTap(ms: number = SECOND_TAP_MS) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setArmed(false)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const tap = useCallback((run: () => void): boolean => {
    if (armed) {
      disarm()
      run()
      return true
    }
    setArmed(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; setArmed(false) }, ms)
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

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setArmedId(null)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const tap = useCallback((id: string, run: () => void): boolean => {
    if (armedId === id) {
      disarm()
      run()
      return true
    }
    if (timer.current) clearTimeout(timer.current)
    setArmedId(id)
    timer.current = setTimeout(() => { timer.current = null; setArmedId(null) }, ms)
    return false
  }, [armedId, disarm, ms])

  return { armedId, tap, disarm }
}
