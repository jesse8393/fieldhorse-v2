// src/lib/logoMigration.ts
//
// Company logos used to live in the private company-logos bucket and the
// profile stored a signed URL to them. Signed URLs expire, so those logos
// eventually disappear from the app header, proposals and invoices. New
// uploads go to the public logos bucket (BrandLogoPicker). This moves an
// old logo over the first time its owner opens the app: the owner can
// still read their own company-logos folder, so the file is copied to
// logos/<user>/ and the profile is pointed at its public URL.

type StorageLike = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>
      upload(path: string, body: Blob, opts?: Record<string, unknown>): Promise<{ error: unknown }>
      getPublicUrl(path: string): { data: { publicUrl: string } }
    }
  }
  from(table: string): any
}

const LEGACY_MARKER = '/object/sign/company-logos/'

/** The caller's own file path inside an old signed company-logos URL, else null. */
export function legacyLogoPath(url: string | null | undefined, userId: string | null | undefined): string | null {
  if (!url || !userId) return null
  const at = url.indexOf(LEGACY_MARKER)
  if (at < 0) return null
  let path: string
  try {
    path = decodeURIComponent(url.slice(at + LEGACY_MARKER.length).split('?')[0])
  } catch {
    return null
  }
  return path.startsWith(`${userId}/`) && !path.includes('..') ? path : null
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/**
 * Copy an old logo to the public bucket and point the profile at it.
 * Returns the new public URL, or null when there was nothing to move or
 * any step failed (the old URL is left in place to try again later).
 */
export async function migrateLegacyLogo(client: StorageLike, userId: string, url: string | null | undefined): Promise<string | null> {
  const path = legacyLogoPath(url, userId)
  if (!path) return null
  const ext = (path.split('.').pop() || '').toLowerCase()
  const contentType = CONTENT_TYPES[ext]
  if (!contentType) return null

  const { data: blob, error: downloadError } = await client.storage.from('company-logos').download(path)
  if (downloadError || !blob) return null

  const newPath = `${userId}/logo-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`
  const { error: uploadError } = await client.storage.from('logos').upload(newPath, blob, { contentType, upsert: false })
  if (uploadError) return null

  const publicUrl = client.storage.from('logos').getPublicUrl(newPath).data.publicUrl
  const { error: updateError } = await client.from('profiles').update({ logo_url: publicUrl }).eq('user_id', userId)
  if (updateError) return null
  return publicUrl
}
