import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const signCalls: string[][] = []
let failPaths = new Set<string>()
let token = 0

vi.mock('./supabase.ts', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => {
          signCalls.push(paths)
          token += 1
          return {
            data: paths.map((path) => failPaths.has(path)
              ? { path, signedUrl: null, error: 'Object not found' }
              : { path, signedUrl: `https://signed/${path}?token=${token}`, error: null }),
            error: null
          }
        }
      })
    }
  }
}))

const { signedUrlsFor, SIGNED_URL_REUSE_MS } = await import('./signedUrls.ts')

let queryClient: QueryClient

beforeEach(() => {
  signCalls.length = 0
  failPaths = new Set()
  token = 0
  queryClient = new QueryClient()
})

describe('signedUrlsFor', () => {
  it('signs every path it has not seen in one request', async () => {
    const urls = await signedUrlsFor(queryClient, 'job-photos', ['a.jpg', 'b.jpg', 'a.jpg'], 1_000)
    expect(signCalls).toEqual([['a.jpg', 'b.jpg']])
    expect(urls.get('a.jpg')).toBe('https://signed/a.jpg?token=1')
    expect(urls.get('b.jpg')).toBe('https://signed/b.jpg?token=1')
  })

  it('hands back the same URL on a remount so the browser cache can serve it', async () => {
    await signedUrlsFor(queryClient, 'job-photos', ['a.jpg'], 1_000)
    const again = await signedUrlsFor(queryClient, 'job-photos', ['a.jpg', 'c.jpg'], 1_000 + 60_000)
    expect(signCalls).toEqual([['a.jpg'], ['c.jpg']])
    expect(again.get('a.jpg')).toBe('https://signed/a.jpg?token=1')
    expect(again.get('c.jpg')).toBe('https://signed/c.jpg?token=2')
  })

  it('signs again once a URL is close to expiring', async () => {
    await signedUrlsFor(queryClient, 'job-photos', ['a.jpg'], 1_000)
    const later = await signedUrlsFor(queryClient, 'job-photos', ['a.jpg'], 1_000 + SIGNED_URL_REUSE_MS)
    expect(signCalls).toEqual([['a.jpg'], ['a.jpg']])
    expect(later.get('a.jpg')).toBe('https://signed/a.jpg?token=2')
  })

  it('keeps buckets apart', async () => {
    await signedUrlsFor(queryClient, 'job-photos', ['a.jpg'], 1_000)
    await signedUrlsFor(queryClient, 'job-files', ['a.jpg'], 1_000)
    expect(signCalls).toEqual([['a.jpg'], ['a.jpg']])
  })

  it('leaves out paths that fail to sign and does not cache them', async () => {
    failPaths = new Set(['gone.jpg'])
    const urls = await signedUrlsFor(queryClient, 'job-photos', ['gone.jpg', 'a.jpg'], 1_000)
    expect(urls.has('gone.jpg')).toBe(false)
    expect(urls.get('a.jpg')).toBeTruthy()
    failPaths = new Set()
    await signedUrlsFor(queryClient, 'job-photos', ['gone.jpg', 'a.jpg'], 2_000)
    expect(signCalls[1]).toEqual(['gone.jpg'])
  })

  it('asks for nothing when there is nothing to sign', async () => {
    expect((await signedUrlsFor(queryClient, 'job-photos', [], 1_000)).size).toBe(0)
    expect(signCalls).toEqual([])
  })
})
