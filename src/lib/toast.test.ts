import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { kind: string; message: string; options: Record<string, any> }[] = []
vi.mock('sonner', () => {
  const record = (kind: string) => (message: string, options: Record<string, any>) => { calls.push({ kind, message, options }) }
  return { toast: Object.assign(record('plain'), { success: record('success'), error: record('error') }) }
})

const { toastError, toastSuccess, toastInfo, toastUndo } = await import('./toast.ts')

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('window', {})
})

// A11Y-11: an error or an Undo that vanishes on a timer is lost to a slow
// reader or a gloved hand (WCAG 2.2.1). They stay until closed; the rest
// still clear themselves.
describe('how long a toast stays', () => {
  it('keeps an error until it is closed', () => {
    toastError("Couldn't save", 'Check your connection.')
    expect(calls[0]).toMatchObject({ kind: 'error', options: { duration: Infinity } })
  })

  it('keeps an Undo until it is closed', () => {
    toastUndo('Task deleted', { onUndo: () => {} })
    expect(calls[0].options.duration).toBe(Infinity)
    expect(calls[0].options.action.label).toBe('Undo')
  })

  it('lets a success or a note clear itself', () => {
    toastSuccess('Saved')
    toastInfo('Synced')
    expect(calls.map(c => c.options.duration)).toEqual([4500, 4500])
  })
})
