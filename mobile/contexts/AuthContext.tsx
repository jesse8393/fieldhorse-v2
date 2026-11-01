// mobile/contexts/AuthContext.tsx
//
// Supabase session provider for the native app. Mirrors the web
// src/contexts/AuthContext.tsx, but persists the session via
// AsyncStorage (handled by the RN supabase client) instead of
// localStorage. Exposes the same shape so screens read `user`/`session`
// the same way the web app does.
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { createSessionBoundary } from '../lib/sessionBoundary'

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: { message: string } | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: { message: string } | null }>
  updatePassword: (password: string) => Promise<{ error: { message: string } | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    let authEvents = 0
    const accountChanged = createSessionBoundary(queryClient)
    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted || authEvents) return
        if (error) console.warn('[fieldhorse] Could not restore the saved session:', error.message)
        accountChanged(data.session?.user.id ?? null)
        setSession(data.session)
      })
      .catch((error) => {
        if (!mounted || authEvents) return
        console.warn('[fieldhorse] Could not read the saved session:', error)
        accountChanged(null, true)
        setSession(null)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return
      authEvents++
      accountChanged(s?.user.id ?? null, event === 'SIGNED_OUT')
      setSession(s)
      setLoading(false)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? { message: error.message } : null }
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      return { error: error ? { message: error.message } : null }
    },
    updatePassword: async (password) => {
      const { error } = await supabase.auth.updateUser({ password })
      return { error: error ? { message: error.message } : null }
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
