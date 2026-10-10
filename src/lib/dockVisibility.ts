import { useEffect, useSyncExternalStore } from 'react'

// Who has asked the phone dock to step aside. Detail screens with their
// own onyx action capsule (Job, Quote) and full screen flows call
// useHideDock(); the dock hides while any request is live (spec 8.1).

const requests = new Set<symbol>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isDockHidden() {
  return requests.size > 0
}

/** Hides the dock while the calling component is mounted and `active` is true. */
export function useHideDock(active = true) {
  useEffect(() => {
    if (!active) return
    const id = Symbol('hide-dock')
    requests.add(id)
    emit()
    return () => {
      requests.delete(id)
      emit()
    }
  }, [active])
}

/** True while any screen has asked the dock to hide. */
export function useDockHidden() {
  return useSyncExternalStore(subscribe, isDockHidden, () => false)
}
