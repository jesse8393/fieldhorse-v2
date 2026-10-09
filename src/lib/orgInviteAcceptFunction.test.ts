import { describe, expect, it } from 'vitest'
import { markOnboarded } from '../../netlify/functions/org-invite-accept.js'

type Profile = { user_id: string; onboarded_at: string | null; company_name?: string | null }

// Minimal stand in for the service role client: profiles upsert (with
// ignoreDuplicates = ON CONFLICT DO NOTHING) and update().eq().is().
function fakeAdmin(profiles: Profile[], opts: { fail?: boolean } = {}) {
  return {
    from(table: string) {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
      return {
        upsert: async (row: Profile, options: { onConflict?: string; ignoreDuplicates?: boolean }) => {
          if (opts.fail) return { error: { message: 'db down' } }
          const existing = profiles.find((p) => p.user_id === row.user_id)
          if (!existing) profiles.push({ ...row })
          else if (!options?.ignoreDuplicates) Object.assign(existing, row)
          return { error: null }
        },
        update: (patch: Partial<Profile>) => {
          const filters: Array<(p: Profile) => boolean> = []
          const query: any = {
            eq: (col: keyof Profile, value: unknown) => { filters.push((p) => p[col] === value); return query },
            is: (col: keyof Profile, value: unknown) => { filters.push((p) => (p[col] ?? null) === value); return query },
            then: (resolve: (r: { error: unknown }) => void) => {
              if (opts.fail) return resolve({ error: { message: 'db down' } })
              for (const p of profiles) if (filters.every((f) => f(p))) Object.assign(p, patch)
              resolve({ error: null })
            }
          }
          return query
        }
      }
    }
  }
}

describe('org invite accept marks the teammate onboarded', () => {
  it('sets onboarded_at on the empty profile the signup trigger created', async () => {
    const profiles: Profile[] = [{ user_id: 'crew-1', onboarded_at: null }]
    await markOnboarded(fakeAdmin(profiles), 'crew-1')
    expect(profiles[0].onboarded_at).toEqual(expect.any(String))
  })

  it('creates the profile row when there is none yet', async () => {
    const profiles: Profile[] = []
    await markOnboarded(fakeAdmin(profiles), 'crew-2')
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ user_id: 'crew-2', onboarded_at: expect.any(String) })
  })

  it('never overwrites an existing onboarded_at or other profile fields', async () => {
    const profiles: Profile[] = [{ user_id: 'owner-1', onboarded_at: '2025-01-01T00:00:00.000Z', company_name: 'Parker Construction' }]
    await markOnboarded(fakeAdmin(profiles), 'owner-1')
    expect(profiles[0]).toEqual({ user_id: 'owner-1', onboarded_at: '2025-01-01T00:00:00.000Z', company_name: 'Parker Construction' })
  })

  it('leaves other users alone', async () => {
    const profiles: Profile[] = [{ user_id: 'someone-else', onboarded_at: null }, { user_id: 'crew-3', onboarded_at: null }]
    await markOnboarded(fakeAdmin(profiles), 'crew-3')
    expect(profiles[0].onboarded_at).toBeNull()
    expect(profiles[1].onboarded_at).toEqual(expect.any(String))
  })

  it('does not throw when the database refuses (the accept already succeeded)', async () => {
    await expect(markOnboarded(fakeAdmin([], { fail: true }), 'crew-4')).resolves.toBeUndefined()
  })
})
