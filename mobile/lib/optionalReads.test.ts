import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClientProvider } from '@tanstack/react-query'

vi.mock('./supabase', () => ({ supabase: {} }))
import { queryClient } from './queryClient'
import { useWeather, useCoverPhotos } from './queries'

// The real native query client throws a failed first read to the root
// boundary, which replaces the whole app. Optional reads must not.
// react-dom/server and the native react types disagree on ReactNode, so the
// element is passed as the type renderToString asks for.
const render = (hook: () => unknown) => renderToString(createElement(QueryClientProvider, {
  client: queryClient,
  children: createElement(() => { hook(); return createElement('div', null, 'screen') })
}) as unknown as Parameters<typeof renderToString>[0])

beforeEach(() => { queryClient.clear() })

describe('optional native reads', () => {
  it('a failed forecast leaves Home on screen', async () => {
    await queryClient.fetchQuery({ queryKey: ['weather', 'default', 'default'], queryFn: async () => { throw new Error('weather fetch failed') }, retry: 0 }).catch(() => null)
    expect(render(() => useWeather(null, null))).toContain('screen')
  })

  it('failed cover photos leave the Jobs list on screen', async () => {
    await queryClient.fetchQuery({ queryKey: ['coverPhotos', 'user'], queryFn: async () => { throw new Error('Storage unavailable') }, retry: 0 }).catch(() => null)
    expect(render(() => useCoverPhotos('user'))).toContain('screen')
  })

  it('a required read still goes to the retry screen', () => {
    const defaults = queryClient.getDefaultOptions().queries as any
    expect(defaults.throwOnError(new Error('x'), { state: { data: undefined } })).toBe(true)
  })
})
