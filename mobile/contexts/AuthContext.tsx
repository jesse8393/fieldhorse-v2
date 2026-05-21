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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
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
      await supabase.auth.signOut()
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
