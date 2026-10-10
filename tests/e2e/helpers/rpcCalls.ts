// Reads the RPC calls the mocked Supabase project recorded for a browser
// context (scripts/qa-mock.mjs records every POST to /rest/v1/rpc/<name>
// once signIn has installed the mock). Pass a name to keep only that
// function's calls. `body` is the JSON the app sent, with the exact p_
// parameter names.
import type { BrowserContext } from '@playwright/test'
import { rpcCalls as readCalls } from '../../../scripts/qa-mock.mjs'

export type RpcCall = { name: string; body: Record<string, unknown>; at: number }

export function rpcCalls(context: BrowserContext, name?: string): RpcCall[] {
  return readCalls(context, name) as RpcCall[]
}
