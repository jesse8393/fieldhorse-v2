import { Toaster as SonnerToaster } from 'sonner'
import { useTheme } from '../contexts/ThemeContext.tsx'

/**
 * Single toast system: Sonner only, mounted once at the root (main.tsx)
 * so a toast fired on a route outside the app shell (onboarding,
 * invites) or right before a navigation is still shown. Sonner does not
 * replay toasts fired while no Toaster is mounted.
 *
 * The legacy fh:toast banner rendered the SAME event a second time (top
 * banner + bottom card for one action), which read as debris.
 * lib/toast.ts still dispatches fh:toast for any listener, but nothing
 * renders it. Desktop: compact bottom-right cards, offset left of the
 * FAB column (FAB is fixed right:20 / 56px wide) so toasts never cover
 * it. Mobile: full-width banner above the bottom nav.
 *
 * The theme follows the app's: Sonner picks its own text colors (toast
 * descriptions, action and cancel buttons) from it, and dark ones are
 * unreadable on the daylight canvas.
 */
export default function AppToaster() {
  const { theme } = useTheme()
  return (
    <SonnerToaster
      position="bottom-right"
      theme={theme}
      richColors
      visibleToasts={3}
      offset={{ bottom: '20px', right: '92px' }}
      mobileOffset={{ bottom: 'calc(var(--fh-mobile-dock-height) + 16px)', left: '16px', right: '16px' }}
      toastOptions={{
        style: {
          maxWidth: 'min(380px, calc(100vw - 32px))',
          background: 'var(--v3-surface-glass)',
          color: 'var(--ink-strong)',
          border: '1px solid rgba(201, 150, 58, 0.35)',
          fontFamily: 'var(--font-body)',
          backdropFilter: 'blur(30px)'
        }
      }}
    />
  )
}
