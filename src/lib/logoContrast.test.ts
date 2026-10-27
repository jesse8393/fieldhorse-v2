import { describe, expect, it } from 'vitest'
import { logoBackdrop } from './logoContrast.ts'
import { DOC_COLORS } from '../components/documents/tokens.ts'

describe('document logo contrast', () => {
  it('backs transparent white marks with ink', () => {
    expect(logoBackdrop(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]))).toBe(DOC_COLORS.ink)
  })
  it('backs transparent dark marks with paper', () => {
    expect(logoBackdrop(new Uint8ClampedArray([20, 20, 20, 255, 0, 0, 0, 0]))).toBe(DOC_COLORS.paper)
  })
  it('does not count transparent RGB pixels as visible logo artwork', () => {
    expect(logoBackdrop(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(DOC_COLORS.ink)
  })
  it('preserves opaque logo backgrounds and empty images', () => {
    expect(logoBackdrop(new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 20, 255]))).toBeNull()
    expect(logoBackdrop(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull()
    expect(logoBackdrop(new Uint8ClampedArray())).toBeNull()
  })
})
