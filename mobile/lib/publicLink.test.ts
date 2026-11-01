import { describe, expect, it, vi, beforeEach } from 'vitest'
const mock = vi.hoisted(() => ({ random: vi.fn(), insert: vi.fn() }))
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: mock.random }))
vi.mock('./supabase', () => ({ supabase: { from: () => ({ insert: mock.insert }) } }))
import { mintPublicLink } from './publicLink'

beforeEach(() => { mock.random.mockReset(); mock.insert.mockReset() })
describe('native public document tokens', () => {
  it('uses native cryptographic bytes before creating the link', async () => {
    mock.random.mockResolvedValue(new Uint8Array(24).fill(7))
    mock.insert.mockResolvedValue({ error: null })
    const link = await mintPublicLink({ userId: 'user', contactId: 'job', kind: 'proposal' })
    expect(mock.random).toHaveBeenCalledWith(24)
    expect(link.token).toHaveLength(24)
    expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ token: link.token }))
  })
  it('does not create a guessable link if secure randomness fails', async () => {
    mock.random.mockRejectedValue(new Error('Native random source unavailable'))
    await expect(mintPublicLink({ userId: 'user', contactId: 'job', kind: 'invoice' })).rejects.toThrow('Native random source unavailable')
    expect(mock.insert).not.toHaveBeenCalled()
  })
})
