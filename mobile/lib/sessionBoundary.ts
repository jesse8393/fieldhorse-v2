import type { QueryClient } from '@tanstack/react-query'

// Clear cached customer/job data before publishing an account change. Keeping
// the cache on token refresh avoids needless loading; a different account must
// never inherit it, even if the old requests finish after sign-out.
export function createSessionBoundary(client: Pick<QueryClient, 'clear'>) {
  let account: string | null = null
  return (nextAccount: string | null, signedOut = false) => {
    if (signedOut || account !== nextAccount) client.clear()
    account = nextAccount
  }
}
