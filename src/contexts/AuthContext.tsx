import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { del as idbDel } from 'idb-keyval'
import { supabase } from '../lib/supabase.ts'
import { queryClient } from '../lib/queryClient.ts'

// Sign-out must also purge the local data stores, or the next person on
// a shared device inherits the whole book (ultrareview): the persisted
// TanStack cache (IndexedDB — jobs/leads/clients with names, phones,
// amounts) and any in-flight lead draft (localStorage). Best-effort:
// storage failures must never block the sign-out itself.
async function purgeLocalData() {
  try { queryClient.clear() } catch { /* non-fatal */ }
  try { await idbDel('fh-query-cache') } catch { /* non-fatal */ }
  try { window.localStorage.removeItem('fh:leadDraft') } catch { /* non-fatal */ }
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<any>
  signUp: (email: string, password: string) => Promise<any>
  signOut: () => Promise<any>
  sendPasswordReset: (email: string) => Promise<any>
  updatePassword: (password: string) => Promise<any>
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
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) => supabase.auth.signUp({ email, password }),
    signOut: async () => {
      const res = await supabase.auth.signOut()
      await purgeLocalData()
      return res
    },
    sendPasswordReset: (email) =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      }),
    updatePassword: (password) => supabase.auth.updateUser({ password })
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
