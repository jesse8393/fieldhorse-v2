import { useCallback, useState, type SetStateAction } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Remember non-sensitive list controls for Back/Forward without storing
 * records. By default the value belongs to one history entry and its
 * query; scope 'path' keeps it for the page whatever the query, for a
 * control (a table sort) that must survive typing in a search kept in ?q=.
 */
export function useHistoryEntryState<T>(name: string, initial: T, validate: (value: unknown) => value is T, scope: 'entry' | 'path' = 'entry') {
  const { key, pathname, search } = useLocation()
  const storageKey = scope === 'path' ? `fh:view:v1:${name}:${pathname}` : `fh:view:v1:${name}:${key}:${pathname}${search}`
  const read = (): T => {
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
      return validate(value) ? value : initial
    } catch { return initial }
  }
  const [snapshot, setSnapshot] = useState(() => ({ key: storageKey, value: read() }))
  const value = snapshot.key === storageKey ? snapshot.value : read()
  const setValue = useCallback((update: SetStateAction<T>) => {
    setSnapshot(previous => {
      let current = initial
      if (previous.key === storageKey) current = previous.value
      else {
        try {
          const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
          if (validate(stored)) current = stored
        } catch { /* Storage can be disabled. Local controls still work. */ }
      }
      const next = typeof update === 'function' ? (update as (value: T) => T)(current) : update
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Optional restoration. */ }
      return { key: storageKey, value: next }
    })
  }, [initial, storageKey, validate])
  return [value, setValue] as const
}
