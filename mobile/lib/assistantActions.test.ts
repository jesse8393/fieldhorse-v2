import { describe, it, expect, vi } from 'vitest'
import { runAssistantAction } from './assistantActions'

const failed = { error: { message: 'Permission denied' } }
const actions = (result: object = { error: null }) => ({
  createLead: vi.fn(async (_input: any) => result), createEvent: vi.fn(async (_input: any) => result),
  createClient: vi.fn(async (_input: any) => result), saveNote: vi.fn(async (_input: any) => result)
})

describe('assistant actions report what really happened', () => {
  for (const [action, data] of [
    ['create_lead', { name: 'Pat' }], ['create_event', { title: 'Pour' }],
    ['create_client', { name: 'Pat' }], ['add_note', { text: 'Call back' }],
  ] as const) {
    it(`${action} says it failed when the save fails`, async () => {
      const reply = await runAssistantAction('user', actions(failed), action, data, 'Added it.')
      expect(reply).not.toContain('Added')
      expect(reply).toContain('Permission denied')
    })
    it(`${action} confirms when the save works`, async () => {
      expect(await runAssistantAction('user', actions(), action, data, 'Done and dusted.')).toBe('Done and dusted.')
    })
  }
  it('a new lead never carries a stage', async () => {
    const a = actions()
    await runAssistantAction('user', a, 'create_lead', { name: 'Pat', stage: 'job' }, '')
    expect(a.createLead.mock.calls[0][0]).not.toHaveProperty('stage')
  })
})
