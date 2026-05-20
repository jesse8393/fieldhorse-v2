import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from './AuthContext.jsx'

const ProfileContext = createContext(null)

export function ProfileProvider({ children }) {
  const { user, session } = useAuth()
  const [profile, setProfile] = useState(null)
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
    async (patch) => {
      if (!user) return { error: new Error('Not signed in') }
      const payload = { user_id: user.id, ...patch }
      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single()
      if (!error) setProfile(data)
      return { data, error }
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
