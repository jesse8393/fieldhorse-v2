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
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource
      }))
    const json = sub.toJSON() as any
    if (!json?.endpoint || !json?.keys?.p256dh || !json?.keys?.auth) return 'failed'
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
    if (error) return 'failed'
    return 'enabled'
  } catch {
    return 'failed'
  }
}

/** Unsubscribe this device and remove its row. */
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await (supabase as any).from('fh_push_subscriptions').delete().eq('endpoint', endpoint)
  } catch { /* best effort */ }
}
