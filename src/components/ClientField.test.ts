import { beforeEach, describe, expect, it, vi } from 'vitest'

const findOrCreateClient = vi.hoisted(() => vi.fn())
const filters: [string, unknown][] = []
let response: { data: unknown; error: unknown }
vi.mock('../lib/clients.ts', () => ({ findOrCreateClient }))
vi.mock('../lib/supabase.ts', () => ({
  supabase: { from: () => {
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder },
      maybeSingle: async () => response,
    }
    return builder
  } },
}))

const { resolveClientId } = await import('./ClientField.tsx')
const customer = { id: 'client-a', name: 'Jordan Reed', phone: '6155550102', email: 'jordan@example.test', address: '12 Test Lane' }

beforeEach(() => {
  filters.length = 0
  findOrCreateClient.mockReset().mockResolvedValue(customer.id)
  response = { data: customer, error: null }
})

describe('customer resolution before saving a record', () => {
  it('copies stored contact details when a typed name matches an existing customer', async () => {
    expect(await resolveClientId({ text: customer.name, picked: null }, { userId: 'user-a', orgId: 'org-a' })).toEqual(customer)
    expect(filters).toContainEqual(['org_id', 'org-a'])
  })

  it('revalidates a saved selection by identity inside its workspace', async () => {
    expect(await resolveClientId({ text: customer.name, picked: { id: customer.id, name: customer.name } }, { userId: 'user-a', orgId: 'org-a' })).toEqual(customer)
    expect(findOrCreateClient).not.toHaveBeenCalled()
    expect(filters).toContainEqual(['id', customer.id])
    expect(filters).toContainEqual(['org_id', 'org-a'])
  })

  it('refuses a removed or inaccessible customer rather than saving a stale selection', async () => {
    response = { data: null, error: null }
    await expect(resolveClientId({ text: customer.name, picked: customer }, { userId: 'user-a', orgId: 'org-b' })).rejects.toThrow(/client/i)
    expect(findOrCreateClient).not.toHaveBeenCalled()
  })

  it('keeps a failed customer read from becoming incomplete job contact information', async () => {
    response = { data: null, error: { message: 'Connection failed' } }
    await expect(resolveClientId({ text: customer.name, picked: null }, { userId: 'user-a', orgId: null })).rejects.toThrow(/client/i)
    expect(filters).toContainEqual(['user_id', 'user-a'])
  })
})
