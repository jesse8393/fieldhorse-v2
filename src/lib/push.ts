// src/lib/push.ts
//
// Client side of web push: permission, subscription, and the
// fh_push_subscriptions row that lets the backend reach this device.
//
// iOS reality check: Safari only allows web push for apps ADDED TO THE
// HOME SCREEN (iOS 16.4+). In a normal Safari tab, PushManager is
// undefined, pushSupport() reports 'needs-install' so the UI can say
// "Add to Home Screen first" instead of failing silently.

import { supabase } from './supabase.ts'

// Public half of the VAPID pair (private half lives on the server in
// fh_app_config). Safe to ship in the bundle by design.
export const VAPID_PUBLIC_KEY =
  'BG5p_lm1-VukSchD3E2kXFXJujpRA8ZJfuv4YaA-LcGzj7MO9S0osYR-Q0OHnUhIAg_HpWh0P4rJ10g-bSBBzwQ'

export type PushSupport = 'ready' | 'needs-install' | 'unsupported'

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    (navigator as any).standalone === true
  )
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'ready'
  }
  // iOS Safari in-browser: SW exists but PushManager doesn't until the
  // app is installed to the home screen.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  if (isIOS && !isStandalone()) return 'needs-install'
  return 'unsupported'
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Is this device already subscribed (and allowed)? */
export async function pushEnabled(): Promise<boolean> {
  try {
    if (pushSupport() !== 'ready') return false
    if (Notification.permission !== 'granted') return false
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return !!sub
  } catch {
    return false
  }
}

function subscribeDevice(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource
  })
}

async function saveSubscription(userId: string, sub: PushSubscription): Promise<{ code?: string } | null> {
  const json = sub.toJSON() as any
  if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return { code: 'invalid_subscription' }
  const { error } = await (supabase as any).from('fh_push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 280),
      last_seen_at: new Date().toISOString()
    },
    { onConflict: 'endpoint' }
  )
  return error || null
}

/**
 * Ask permission, subscribe this device, persist the subscription.
 * Must be called from a user gesture (tap), per platform rules.
 * Returns 'enabled' | 'denied' | 'failed'.
 */
export async function enablePush(userId: string): Promise<'enabled' | 'denied' | 'failed'> {
  try {
    if (pushSupport() !== 'ready' || !userId) return 'failed'
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return 'denied'
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    let error = await saveSubscription(userId, existing || (await subscribeDevice(reg)))
    if (error?.code === '42501' && existing) {
      // The browser handed back a subscription that another account on
      // this device registered (it signed out before sign out removed
      // it). That row is not ours to update, so start a fresh
      // subscription; the server prunes the old endpoint once it fails.
      await existing.unsubscribe()
      error = await saveSubscription(userId, await subscribeDevice(reg))
    }
    return error ? 'failed' : 'enabled'
  } catch {
    return 'failed'
  }
}

// getRegistration, not serviceWorker.ready: ready never settles when no
// service worker is registered (dev builds, a cleared install), and sign
// out waits on these helpers.
async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager?.getSubscription()) ?? null
}

/** Unsubscribe this device and remove its row. */
export async function disablePush(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await (supabase as any).from('fh_push_subscriptions').delete().eq('endpoint', endpoint)
  } catch { /* best effort */ }
}

/**
 * Stop this device receiving the signed out account's notifications
 * when there is no session left to delete the row with (session expired,
 * signed out in another tab). The server prunes the dead endpoint the
 * next time a send to it fails.
 */
export async function unsubscribePushLocally(): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (sub) await sub.unsubscribe()
  } catch { /* best effort */ }
}
