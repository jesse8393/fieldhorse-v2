// mobile/lib/supabase.ts
//
// React Native Supabase client. Differs from the web client in one
// way: session persistence uses AsyncStorage (RN has no localStorage)
// and we disable URL session detection (no browser redirect flow).
// The url-polyfill import is required for supabase-js in RN.
//
// Env: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
// (set in mobile/.env or eas.json). Same project as the web app, so
// the mobile app reads/writes the exact same data.

import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL as string
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
})
