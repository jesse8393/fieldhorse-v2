import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
  // Tracks whether a session was ever established, so we can purge on a
  // session→null transition without firing on the initial null.
  const hadSessionRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      hadSessionRef.current = !!data.session
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // A SIGNED_OUT event (token expiry, remote revocation, sign-out in
      // another tab) — or any transition from an established session to
      // null — must purge the local book too, not just the app's own
      // signOut(). Guard the initial null so we never purge before anyone
      // signed in. Best-effort + async-safe (purgeLocalData swallows its
      // own errors).
      if (event === 'SIGNED_OUT' || (hadSessionRef.current && !s)) {
        void purgeLocalData()
      }
      hadSessionRef.current = !!s
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Memoized so a token-refresh onAuthStateChange (which only rebuilds the
  // session object) doesn't mint a new context value every render and
  // cascade a full-app re-render through every consumer.
  const value = useMemo<AuthContextValue>(() => ({
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
  }), [session, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
