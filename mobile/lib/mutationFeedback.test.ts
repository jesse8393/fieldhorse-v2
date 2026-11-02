import { describe, expect, it, vi } from 'vitest'
import { createMutationFeedback } from './mutationFeedback'

function fixture() {
  let active = true
  const pending = vi.fn()
  const failed = vi.fn()
  return {
    run: createMutationFeedback({ active: () => active, pending, failed }),
    pending, failed, leave: () => { active = false },
  }
}

describe('native mutation feedback', () => {
  it('retains a task draft after refusal and allows a confirmed retry', async () => {
    const { run, failed } = fixture()
    let draft = 'Confirm delivery access'
    const save = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'Access revoked' } })
      .mockResolvedValueOnce({ error: null, id: 'saved-task' })
    if (await run('task', 'Could not add task', save)) draft = ''
    expect(draft).toBe('Confirm delivery access')
    expect(failed).toHaveBeenCalledWith('Could not add task', 'Access revoked')
    if (await run('task', 'Could not add task', save)) draft = ''
    expect(draft).toBe('')
  })

  it('reports interrupted requests and releases pending controls', async () => {
    const { run, pending, failed } = fixture()
    expect(await run('edit', 'Could not save', async () => { throw new Error('Network interrupted') })).toBeNull()
    expect(failed).toHaveBeenCalledWith('Could not save', 'Network interrupted')
    expect(pending.mock.calls.at(-1)?.[0].size).toBe(0)
  })

  it('suppresses a second tap while allowing unrelated actions', async () => {
    const { run, pending } = fixture()
    let finish!: (value: { error: null; id: string }) => void
    const request = vi.fn(() => new Promise<{ error: null; id: string }>(resolve => { finish = resolve }))
    const first = run('create-invoice', 'Could not save', request)
    expect(await run('create-invoice', 'Could not save', request)).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    expect(await run('save-note', 'Could not save', async () => ({ error: null, id: 'note' }))).toEqual({ error: null, id: 'note' })
    expect(pending.mock.calls.at(-1)?.[0]).toEqual(new Set(['create-invoice']))
    finish({ error: null, id: 'invoice' })
    expect(await first).toEqual({ error: null, id: 'invoice' })
    expect(pending.mock.calls.at(-1)?.[0].size).toBe(0)
  })

  for (const result of [{ error: null }, { error: { message: 'Previous account refused' } }]) {
    it('ignores late results after the screen unmounts', async () => {
      const { run, leave, failed, pending } = fixture()
      let finish!: (value: typeof result) => void
      const saving = run('save', 'Could not save', () => new Promise<typeof result>(resolve => { finish = resolve }))
      leave()
      finish(result)
      expect(await saving).toBeNull()
      expect(failed).not.toHaveBeenCalled()
      expect(pending).toHaveBeenCalledTimes(1)
    })
  }
})
