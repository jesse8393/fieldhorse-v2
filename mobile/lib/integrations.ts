// mobile/lib/integrations.ts
//
// Integration hub data layer. Reads fh_integrations (migration 030) to
// show connection status per provider, and exposes connect/disconnect.
//
// The OAuth/token work lives in Supabase Edge Functions (service role) :
// the client only kicks off the flow and reads status. Until a provider's
// edge function is deployed with real credentials, `connect` reports that
// the backend isn't wired yet rather than launching a broken flow.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export type ProviderId =
  | 'quickbooks' | 'stripe' | 'jobber' | 'google_calendar' | 'gohighlevel'

export type IntegrationStatus = 'disconnected' | 'connected' | 'error' | 'expired'

export type IntegrationRow = {
  id: string
  provider: ProviderId
  status: IntegrationStatus
  display_name: string | null
  external_account_id: string | null
  last_synced_at: string | null
  last_error: string | null
}

export type ProviderMeta = {
  id: ProviderId
  name: string
  blurb: string
  // Whether the provider's edge function is deployed + credentialed. Flip
  // to true per provider as each goes live so the card launches OAuth.
  live: boolean
  // Extra context shown on the card for not-yet-live providers.
  setupNote?: string
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    blurb: 'Accept card & ACH payments on invoices; reconcile automatically to payments.',
    live: false,
    setupNote: 'Needs your Stripe secret key in the edge function.'
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    blurb: 'Sync customers, invoices & payments to QBO.',
    live: false,
    setupNote: 'Needs an Intuit developer app (client id/secret) + production review.'
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    blurb: 'Two way sync your schedule with Google Calendar.',
    live: false,
    setupNote: 'Needs a Google OAuth client id/secret + consent screen.'
  },
  {
    id: 'gohighlevel',
    name: 'GoHighLevel',
    blurb: 'Send SMS reminders & sync contacts through GHL.',
    live: false,
    setupNote: 'Needs your GHL API key (or OAuth app) + location id.'
  },
  {
    id: 'jobber',
    name: 'Jobber',
    blurb: 'One time import of customers & jobs from Jobber.',
    live: false,
    setupNote: 'Needs a Jobber developer app (client id/secret) + partner approval.'
  }
]

async function fetchIntegrations(userId: string): Promise<IntegrationRow[]> {
  const { data, error } = await supabase
    .from('fh_integrations' as any)
    .select('id, provider, status, display_name, external_account_id, last_synced_at, last_error')
    .eq('user_id', userId)
  // Table may not exist yet (migration not applied), treat as none connected.
  if (error) return []
  return (data ?? []) as unknown as IntegrationRow[]
}

export function useIntegrations(userId: string | undefined) {
  return useQuery({
    queryKey: ['integrations', userId],
    queryFn: () => fetchIntegrations(userId as string),
    enabled: !!userId
  })
}

export function useDisconnectIntegration() {
  const client = useQueryClient()
  return async (input: { userId: string; provider: ProviderId }) => {
    const { error } = await supabase
      .from('fh_integrations' as any)
      .update({ status: 'disconnected' } as any)
      .eq('user_id', input.userId)
      .eq('provider', input.provider)
    if (!error) client.invalidateQueries({ queryKey: ['integrations', input.userId] })
    return { error }
  }
}

// Where the OAuth-start edge function will live, derived from the project
// URL. Used once a provider goes live.
export function oauthStartUrl(provider: ProviderId): string {
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL as string) || ''
  return `${base}/functions/v1/integrations-oauth-start?provider=${provider}`
}
