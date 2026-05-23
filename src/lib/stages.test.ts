import { describe, it, expect, vi } from 'vitest'

// margin/marginTier are pure; stub the client module so importing stages.ts
// doesn't try to construct a real Supabase client in the test env.
vi.mock('./supabase.ts', () => ({ supabase: {} }))

const { margin, marginTier } = await import('./stages.ts')

describe('margin', () => {
  it('is 0 when there is no contract amount', () => {
    expect(margin({ amount: 0, cost: 0 })).toBe(0)
    expect(margin({ amount: 0, cost: 500 })).toBe(0)
    expect(margin(null)).toBe(0)
    expect(margin(undefined)).toBe(0)
  })

  it('computes (amount - cost) / amount as a percentage', () => {
    expect(margin({ amount: 1000, cost: 700 })).toBe(30)
    expect(margin({ amount: 1000, cost: 0 })).toBe(100)
    expect(margin({ amount: 2000, cost: 1500 })).toBe(25)
  })

  it('goes negative when cost exceeds the contract', () => {
    expect(margin({ amount: 1000, cost: 1200 })).toBe(-20)
  })

  it('treats null/undefined cost as zero', () => {
    expect(margin({ amount: 1000, cost: null })).toBe(100)
    expect(margin({ amount: 1000 } as any)).toBe(100)
  })
})

describe('marginTier', () => {
  it('classifies healthy / thin / warning bands', () => {
    expect(marginTier(40)).toBe('good')
    expect(marginTier(30)).toBe('good')
    expect(marginTier(29.9)).toBe('warn')
    expect(marginTier(15)).toBe('warn')
    expect(marginTier(14.9)).toBe('thin')
    expect(marginTier(0)).toBe('thin')
    expect(marginTier(-20)).toBe('thin')
  })
})
