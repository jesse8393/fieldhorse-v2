/** Check for deployed code without interrupting a form or clearing offline work. */
export function watchAppUpdates(onReady: () => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}
  const workers = navigator.serviceWorker
  let previous = workers.controller
  let stopped = false
  let checking = false
  let lastCheck = 0

  const changed = () => {
    const current = workers.controller
    // Claiming a page on its first install does not mean an update shipped.
    if (previous && current && current !== previous) onReady()
    previous = current
  }
  const check = async () => {
    if (stopped || checking || document.visibilityState === 'hidden' || navigator.onLine === false) return
    if (lastCheck && Date.now() - lastCheck < 60_000) return
    checking = true
    lastCheck = Date.now()
    try {
      const registration = await workers.getRegistration()
      if (!stopped && registration) await registration.update()
    } catch { /* Offline and blocked worker checks should never interrupt work. */ }
    finally { checking = false }
  }
  workers.addEventListener('controllerchange', changed)
  document.addEventListener('visibilitychange', check)
  window.addEventListener('online', check)
  const interval = window.setInterval(check, 5 * 60_000)
  void check()

  return () => {
    stopped = true
    workers.removeEventListener('controllerchange', changed)
    document.removeEventListener('visibilitychange', check)
    window.removeEventListener('online', check)
    window.clearInterval(interval)
  }
}
