import { supabase } from './supabase.ts'
import type { Json } from './database.types.ts'

export function preferenceObject(value: unknown): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Json | undefined> : {}
}

/** Preserve preferences saved by another screen while this screen was open. */
export async function updateProfilePreferences(userId: string, transform: (current: Record<string, Json | undefined>) => Record<string, Json | undefined>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error: readError } = await supabase.from('profiles').select('preferences').eq('user_id', userId).single()
    if (readError || !current) throw new Error(readError?.message || 'Your profile is unavailable. Refresh and try again.')
    const next = transform(preferenceObject(current.preferences))
    let query = supabase.from('profiles').update({ preferences: next }).eq('user_id', userId)
    query = current.preferences === null ? query.is('preferences', null) : query.eq('preferences', JSON.stringify(current.preferences))
    const { data, error } = await query.select('user_id').maybeSingle()
    if (error) throw new Error(error.message)
    if (data?.user_id === userId) return
  }
  throw new Error('Your preferences changed elsewhere. Refresh and try again.')
}
