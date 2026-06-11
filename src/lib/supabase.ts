import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

const env = (import.meta as any).env
const url = env.VITE_SUPABASE_URL as string
const key = env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  console.warn('[fieldhorse] Missing Supabase env vars. Copy .env.example to .env.local.')
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})

// Bearer header for Netlify function calls that require the signed-in
// user's access token (/api/send-*, /api/claude). Returns {} when no
// session exists so callers fail server-side with a clean 401 instead
// of throwing here.
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
