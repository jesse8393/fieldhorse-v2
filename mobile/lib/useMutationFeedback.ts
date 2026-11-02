import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { createMutationFeedback } from './mutationFeedback'

export function useMutationFeedback() {
  const active = useRef(true)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [run] = useState(() => createMutationFeedback({
    active: () => active.current,
    pending: setPending,
    failed: (title, message) => Alert.alert(title, message),
  }))
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  return { run, pending }
}
