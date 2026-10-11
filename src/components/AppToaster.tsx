import { Toaster as SonnerToaster } from 'sonner'

/**
 * Single toast system: Sonner only, mounted once at the root (main.tsx)
 * so a toast fired on a route outside the app shell (onboarding,
 * invites) or right before a navigation is still shown. Sonner does not
 * replay toasts fired while no Toaster is mounted.
 *
 * Redesign (spec section 7): every toast is an onyx card with linen
 * text, in both themes, so Sonner runs in its dark theme for its own
 * description, action and close colors. Sonner announces toasts in a
 * polite live region. Phone: full width above the dock. Desktop: bottom
 * right, left of the capture button column.
 */
export default function AppToaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      visibleToasts={3}
      offset={{ bottom: '20px', right: '92px' }}
      mobileOffset={{ bottom: 'calc(var(--fh-mobile-dock-height) + 16px)', left: '16px', right: '16px' }}
      toastOptions={{
        className: 'fhs-toast fh-onyx-scope',
        style: {
          maxWidth: 'min(380px, calc(100vw - 32px))',
          background: 'var(--fh-onyx)',
          color: 'var(--fh-linen)',
          border: '1px solid var(--fh-onyx-line)',
          borderRadius: 14,
          boxShadow: 'var(--fh-shadow-overlay)',
          fontFamily: 'var(--fh-font-body)'
        }
      }}
    />
  )
}
