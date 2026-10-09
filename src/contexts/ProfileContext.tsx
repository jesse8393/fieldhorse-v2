import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './AuthContext.tsx'
import type { Database } from '../lib/database.types.ts'

type Profile = Database['public']['Tables']['profiles']['Row']

type ProfileContextValue = {
  profile: Profile | null
  // True only until the first load for the signed in user finishes.
  // Later refetches run silently: RequireOnboarded swaps the whole app
  // for a loader while this is true, which would throw away open sheets
  // and half typed forms.
  loading: boolean
  // Most recent fetch error message, or null when the last load
  // succeeded. Consumers (Home, Settings, onboarding) check this to
  // show a retry banner instead of silently rendering empty state.
  error: string | null
  isOnboarded: boolean
  refresh: () => Promise<void>
  upsertProfile: (patch: Record<string, unknown>) => Promise<{ data?: Profile; error: any }>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The user whose first load has finished (see loading above).
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const loadedUserIdRef = useRef<string | null>(null)
  // Tracks the auth user a fetch was started for. An in-flight fetch
  // for user A can resolve after a fast sign-out→sign in to user B;
  // without this guard the stale response would overwrite B's profile
  // (the closure check below compares against its own stale user).
  const activeUserIdRef = useRef<string | null>(null)
  // Only the newest fetch may write state (refetches can overlap).
  const fetchSeqRef = useRef(0)
  const latestFetchRef = useRef<Promise<void> | null>(null)
  const lastFetchFailedRef = useRef(false)

  const runFetch = useCallback(async (seq: number) => {
    const uid = userId
    if (!uid) {
      setProfile(null)
      setLoading(false)
      setError(null)
      return
    }
    if (loadedUserIdRef.current !== uid) {
      setLoading(true)
      setError(null)
    }
    let data: Profile | null = null
    let fetchError: { message?: string } | null = null
    try {
      const res = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle()
      data = res.data
      fetchError = res.error
    } catch (e) {
      fetchError = { message: e instanceof Error ? e.message : '' }
    }
    // Drop the response if the auth user changed, or a newer fetch
    // started, while we were waiting.
    if (activeUserIdRef.current !== uid || fetchSeqRef.current !== seq) return
    loadedUserIdRef.current = uid
    setLoadedUserId(uid)
    if (fetchError) {
      console.warn('[fieldhorse] profile fetch error', fetchError)
      lastFetchFailedRef.current = true
      setError(fetchError.message || 'Could not load profile')
      setLoading(false)
      return
    }
    lastFetchFailedRef.current = false
    setError(null)
    // Multi-tenant guard: only accept the row if it actually belongs to
    // the current auth user. Prevents a stale cross-user profile from
    // leaking into state during a fast sign-out→sign in transition.
    setProfile(data && data.user_id === uid ? data : null)
    setLoading(false)
  }, [userId])

  // Resolves once the newest fetch has settled, so a caller of refresh()
  // never acts on a profile an overlapping refetch is about to replace.
  const fetchProfile = useCallback((): Promise<void> => {
    const seq = ++fetchSeqRef.current
    const settled: Promise<void> = runFetch(seq).then(() => {
      const latest = latestFetchRef.current
      if (fetchSeqRef.current !== seq && latest && latest !== settled) return latest
    })
    latestFetchRef.current = settled
    return settled
  }, [runFetch])

  // Clear the prior profile the instant the auth user changes so a
  // renaming screen never paints with the previous user's name, then
  // load. Keyed on the user id, not the access token: a token refresh
  // must not refetch, let alone flash the loader.
  useEffect(() => {
    activeUserIdRef.current = userId
    loadedUserIdRef.current = null
    lastFetchFailedRef.current = false
    setLoadedUserId(null)
    setProfile(null)
    setError(null)
    void fetchProfile()
  }, [userId, fetchProfile])

  // Retry quietly when the network comes back (an offline cold open
  // leaves the profile unresolved), and when the app returns to the
  // foreground after a failed load.
  useEffect(() => {
    if (!userId) return
    const onOnline = () => { void fetchProfile() }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && lastFetchFailedRef.current) void fetchProfile()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, fetchProfile])

  const upsertProfile = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!userId) return { error: new Error('Not signed in') }
      const payload = { user_id: userId, ...patch }
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload as Database['public']['Tables']['profiles']['Insert'], { onConflict: 'user_id' })
        .select()
        .single()
      if (!error && activeUserIdRef.current === userId) setProfile(data)
      return { data: data ?? undefined, error }
    },
    [userId]
  )

  // Memoized so a token-refresh onAuthStateChange (which no longer
  // refetches) doesn't mint a new context value every render and
  // cascade a full-app re-render.
  const value = useMemo<ProfileContextValue>(() => ({
    profile,
    loading: loading || loadedUserId !== userId,
    error,
    isOnboarded: Boolean(profile?.onboarded_at),
    refresh: fetchProfile,
    upsertProfile
  }), [profile, loading, loadedUserId, userId, error, fetchProfile, upsertProfile])

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider')
  return ctx
}
