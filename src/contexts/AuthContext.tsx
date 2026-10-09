import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { del as idbDel } from 'idb-keyval'
import { supabase, setActiveOrgId } from '../lib/supabase.ts'
import { setOrgApiOrgId } from '../lib/orgApi.ts'
import { queryClient } from '../lib/queryClient.ts'
import { flushOutbox, clearOutbox } from '../lib/outbox.ts'
import { flushOutbox as flushCaptureOutbox, clearCaptureOutbox } from '../lib/captureOutbox.ts'
import { disablePush, unsubscribePushLocally } from '../lib/push.ts'
import { toastError } from '../lib/toast.ts'

// How long sign out waits for queued offline work to sync, and for this
// device's push subscription to be removed, before carrying on.
const SIGN_OUT_FLUSH_MS = 4000
const SIGN_OUT_PUSH_MS = 3000

function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(undefined) }
    )
  })
}

// Per user keys in localStorage: the lead draft, the running time punch,
// the time clock state (fh:timeclock:<job>:start, hourly rate) and each
// user's last resolved org (fh:orgScope:<user>, lib/orgScope.ts).
const USER_STORAGE_KEYS = ['fh:leadDraft', 'fh:timepunch:activeId']
const USER_STORAGE_PREFIXES = ['fh:timeclock:', 'fh:orgScope:']

function clearUserStorage() {
  try {
    const storage = window.localStorage
    const keys = [...USER_STORAGE_KEYS]
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && USER_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key)
    }
    for (const key of keys) {
      try { storage.removeItem(key) } catch { /* non-fatal */ }
    }
  } catch { /* storage blocked: nothing was stored either */ }
}

// Sign-out must also purge the local data stores, or the next person on
// a shared device inherits the whole book (ultrareview): the persisted
// TanStack cache (IndexedDB, jobs/leads/clients with names, phones,
// amounts), both offline outboxes (queued rows, photos and captured
// notes would otherwise replay under the next account), the per user
// keys above, and this device's push subscription. Best-effort: storage
// failures must never block the sign-out itself.
async function purgeLocalData() {
  // Forget the workspace first (synchronously, before any await) so no
  // request made from here on names the signed out account's org.
  setActiveOrgId(null)
  setOrgApiOrgId(null)
  try { queryClient.clear() } catch { /* non-fatal */ }
  try { await idbDel('fh-query-cache') } catch { /* non-fatal */ }
  try { await clearOutbox() } catch { /* non-fatal */ }
  try { clearCaptureOutbox() } catch { /* non-fatal */ }
  clearUserStorage()
  await settleWithin(unsubscribePushLocally(), SIGN_OUT_PUSH_MS)
}

type AuthContextValue = {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<any>
  // redirectPath: where the email confirmation link should land (an
  // invite page, say). Must be a same origin path.
  signUp: (email: string, password: string, redirectPath?: string) => Promise<any>
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
    let mounted = true
    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) console.warn('[fieldhorse] Could not restore the saved session:', error.message)
        setSession(data.session)
        hadSessionRef.current = !!data.session
      })
      .catch((error) => {
        if (!mounted) return
        console.warn('[fieldhorse] Could not read the saved session:', error)
        setSession(null)
        hadSessionRef.current = false
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // A SIGNED_OUT event (token expiry, remote revocation, sign-out in
      // another tab), or any transition from an established session to
      // null, must purge the local book too, not just the app's own
      // signOut(). Guard the initial null so we never purge before anyone
      // signed in. Best-effort + async-safe (purgeLocalData swallows its
      // own errors).
      if (event === 'SIGNED_OUT' || (hadSessionRef.current && !s)) {
        void purgeLocalData()
      }
      hadSessionRef.current = !!s
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Memoized so a token-refresh onAuthStateChange (which only rebuilds the
  // session object) doesn't mint a new context value every render and
  // cascade a full-app re-render through every consumer.
  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password, redirectPath) =>
      supabase.auth.signUp({
        email,
        password,
        options: redirectPath ? { emailRedirectTo: `${window.location.origin}${redirectPath}` } : undefined
      }),
    signOut: async () => {
      const userId = session?.user?.id
      const online = typeof navigator === 'undefined' || navigator.onLine !== false
      // 1. Give queued offline work a moment to land while this session
      //    can still write it.
      await settleWithin(
        Promise.allSettled([
          flushOutbox(),
          userId && online ? flushCaptureOutbox(userId) : Promise.resolve(0)
        ]),
        SIGN_OUT_FLUSH_MS
      )
      // 2. Remove this device's push subscription while the JWT can still
      //    delete its row, so the next person on the device does not get
      //    this account's notifications. Offline the sign out itself will
      //    fail, so leave push alone; a later purge unsubscribes locally.
      if (online) await settleWithin(disablePush(), SIGN_OUT_PUSH_MS)
      // 3. Sign out this device only. The default (global) scope would
      //    also end the user's sessions on every other device.
      let res: { error: any }
      try {
        res = await supabase.auth.signOut({ scope: 'local' })
      } catch (error) {
        res = { error }
      }
      if (res.error) {
        // auth-js keeps the session when the logout request fails (no
        // signal), so the user is still signed in. Keep their cached
        // book and queued offline work rather than wiping it.
        console.warn('[fieldhorse] sign out failed', res.error)
        toastError("Couldn't sign out", 'Check your connection and try again.')
        return res
      }
      // 4. Purge everything this account left on the device.
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
