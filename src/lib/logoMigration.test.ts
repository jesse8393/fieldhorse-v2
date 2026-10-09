import { describe, expect, it } from 'vitest'
import { legacyLogoPath, migrateLegacyLogo } from './logoMigration.ts'

const UID = 'c368bbb4-5ea1-4b51-89f0-4c91fdfd4de0'
const SIGNED = `https://x.supabase.co/storage/v1/object/sign/company-logos/${UID}/logo.png?token=abc`

describe('legacy logo detection', () => {
  it('finds the caller own file inside an old signed URL', () => {
    expect(legacyLogoPath(SIGNED, UID)).toBe(`${UID}/logo.png`)
  })

  it('ignores public logos, other users and odd paths', () => {
    expect(legacyLogoPath(`https://x.supabase.co/storage/v1/object/public/logos/${UID}/logo-1.png`, UID)).toBeNull()
    expect(legacyLogoPath(SIGNED, 'someone-else')).toBeNull()
    expect(legacyLogoPath(`https://x.supabase.co/storage/v1/object/sign/company-logos/${UID}/../x.png`, UID)).toBeNull()
    expect(legacyLogoPath(null, UID)).toBeNull()
  })
})

describe('legacy logo migration', () => {
  function fakeClient(opts: { downloadFails?: boolean } = {}) {
    const calls: string[] = []
    const client: any = {
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            calls.push(`download ${bucket}/${path}`)
            return opts.downloadFails ? { data: null, error: new Error('no') } : { data: new Blob(['png']), error: null }
          },
          upload: async (path: string) => { calls.push(`upload ${bucket}/${path.replace(/logo-\d+/, 'logo-TS')}`); return { error: null } },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        }),
      },
      from: (table: string) => ({
        update: (patch: any) => ({
          eq: async () => { calls.push(`update ${table} ${Object.keys(patch).join(',')}`); return { error: null } },
        }),
      }),
    }
    return { client, calls }
  }

  it('copies the file to the public bucket and points the profile at it', async () => {
    const { client, calls } = fakeClient()
    const url = await migrateLegacyLogo(client, UID, SIGNED)
    expect(url).toMatch(new RegExp(`/object/public/logos/${UID}/logo-\\d+\\.png$`))
    expect(calls).toEqual([
      `download company-logos/${UID}/logo.png`,
      `upload logos/${UID}/logo-TS.png`,
      'update profiles logo_url',
    ])
  })

  it('leaves everything alone when the old file cannot be read', async () => {
    const { client, calls } = fakeClient({ downloadFails: true })
    expect(await migrateLegacyLogo(client, UID, SIGNED)).toBeNull()
    expect(calls).toEqual([`download company-logos/${UID}/logo.png`])
  })
})
