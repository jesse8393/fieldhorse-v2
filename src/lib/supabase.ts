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
