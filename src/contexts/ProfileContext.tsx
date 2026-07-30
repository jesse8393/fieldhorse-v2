import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './AuthContext.tsx'
import type { Database } from '../lib/database.types.ts'

type Profile = Database['public']['Tables']['profiles']['Row']

type ProfileContextValue = {
  profile: Profile | null
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
  const { user, session } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Tracks the auth user a fetch was started for. An in-flight fetch
  // for user A can resolve after a fast sign-out→sign in to user B;
  // without this guard the stale response would overwrite B's profile
  // (the closure check below compares against its own stale user).
  const activeUserIdRef = useRef<string | null>(null)

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    // Drop the response if the auth user changed while we were waiting.
    if (activeUserIdRef.current !== user.id) return
    if (fetchError) {
      console.warn('[fieldhorse] profile fetch error', fetchError)
      setError(fetchError.message || 'Could not load profile')
      setLoading(false)
      return
    }
    // Multi-tenant guard: only accept the row if it actually belongs to
    // the current auth user. Prevents a stale cross-user profile from
    // leaking into state during a fast sign-out→sign in transition.
    setProfile(data && data.user_id === user.id ? data : null)
    setLoading(false)
  }, [user?.id])

  // Clear the prior profile the instant the auth user changes so a
  // renaming screen never paints with the previous user's name.
  useEffect(() => {
    activeUserIdRef.current = user?.id ?? null
    setProfile(null)
    setError(null)
  }, [user?.id])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile, session?.access_token])

  const upsertProfile = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!user) return { error: new Error('Not signed in') }
      const payload = { user_id: user.id, ...patch }
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload as Database['public']['Tables']['profiles']['Insert'], { onConflict: 'user_id' })
        .select()
        .single()
      if (!error) setProfile(data)
      return { data: data ?? undefined, error }
    },
    [user?.id]
  )

  // Memoized so a token-refresh onAuthStateChange (which reruns the fetch
  // but often resolves to the same profile) doesn't mint a new context
  // value every render and cascade a full-app re-render.
  const value = useMemo<ProfileContextValue>(() => ({
    profile,
    loading,
    error,
    isOnboarded: Boolean(profile?.onboarded_at),
    refresh: fetchProfile,
    upsertProfile
  }), [profile, loading, error, fetchProfile, upsertProfile])

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider')
  return ctx
}
