import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './AuthContext.tsx'
import type { Database } from '../lib/database.types.ts'

type Profile = Database['public']['Tables']['profiles']['Row']

type ProfileContextValue = {
  profile: Profile | null
  loading: boolean
  isOnboarded: boolean
  refresh: () => Promise<void>
  upsertProfile: (patch: Record<string, unknown>) => Promise<{ data?: Profile; error: any }>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) console.warn('[fieldhorse] profile fetch error', error)
    // Multi-tenant guard: only accept the row if it actually belongs to
    // the current auth user. Prevents a stale cross-user profile from
    // leaking into state during a fast sign-out→sign-in transition.
    setProfile(data && data.user_id === user.id ? data : null)
    setLoading(false)
  }, [user])

  // Clear the prior profile the instant the auth user changes so a
  // renaming screen never paints with the previous user's name.
  useEffect(() => {
    setProfile(null)
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
    [user]
  )

  const value = {
    profile,
    loading,
    isOnboarded: Boolean(profile?.onboarded_at),
    refresh: fetchProfile,
    upsertProfile
  }

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile() {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider')
  return ctx
}
