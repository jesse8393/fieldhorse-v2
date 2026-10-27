import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transition: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), in: vi.fn(), limit: vi.fn(),
  toast: vi.fn(), hapticMedium: vi.fn()
}))

vi.mock('./supabase.ts', () => ({ supabase: { from: mocks.from } }))
vi.mock('./stages.ts', () => ({
  transitionStage: mocks.transition,
  completeJob: vi.fn(), markLost: vi.fn(), logPayment: vi.fn(),
  WON_STAGES: ['job', 'invoice', 'closed'],
  STAGE_MAP: { job: { label: 'Job' } }
}))
vi.mock('./toast.ts', () => ({ toast: mocks.toast, hapticMedium: mocks.hapticMedium, hapticSuccess: vi.fn() }))

const { reopen, reopenQuestion } = await import('./pipeline.ts')
const contact = { id: 'job-1', user_id: 'owner-1', stage: 'lost', name: 'Client', job_title: 'Patio', address: null, amount: 1000 }

beforeEach(() => {
  vi.clearAllMocks()
  const chain = { select: mocks.select, eq: mocks.eq, in: mocks.in, limit: mocks.limit }
  mocks.from.mockReturnValue(chain)
  mocks.select.mockReturnValue(chain)
  mocks.eq.mockReturnValue(chain)
  mocks.in.mockReturnValue(chain)
  mocks.limit.mockResolvedValue({ data: [], error: null })
  mocks.transition.mockResolvedValue({ data: { ...contact, stage: 'job' }, error: null })
})

describe('reopen preserves canonical jobs and never invents won work', () => {
  it.each(['job', 'invoice', 'closed'])('returns a lost job with previous %s history to Jobs', async (to_stage) => {
    mocks.limit.mockResolvedValue({ data: [{ to_stage }], error: null })
    await expect(reopen(contact)).resolves.toMatchObject({ data: { stage: 'job' }, error: null })
    expect(mocks.from).toHaveBeenCalledWith('fh_stage_transitions')
    expect(mocks.eq).toHaveBeenCalledWith('contact_id', contact.id)
    expect(mocks.in).toHaveBeenCalledWith('to_stage', ['job', 'invoice', 'closed'])
    expect(mocks.transition).toHaveBeenCalledExactlyOnceWith(contact, 'job')
    expect(mocks.toast).toHaveBeenCalledOnce()
    expect(reopenQuestion(contact).body).toBe('It moves back to Jobs.')
  })

  it('does not convert a legacy never won lead to a job or hidden lead contact', async () => {
    const result = await reopen(contact)
    expect(result.error?.message).toBe('This record has no previous job. Review its lead or quote before reopening.')
    expect(mocks.transition).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('does not write or announce success when job history cannot be verified', async () => {
    mocks.limit.mockResolvedValue({ data: null, error: { message: 'server detail' } })
    expect((await reopen(contact)).error?.message).toContain('Could not verify')
    expect(mocks.transition).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('reopens a closed job without requiring historical backfill', async () => {
    const closed = { ...contact, stage: 'closed' }
    await reopen(closed)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.transition).toHaveBeenCalledExactlyOnceWith(closed, 'job')
    expect(reopenQuestion(closed).body).toBe('It moves back to Jobs.')
  })

  it('rejects migrated and active records before any read or write', async () => {
    for (const stage of ['moved_lead', 'moved_quote', 'lead', 'quote', 'job']) {
      expect((await reopen({ ...contact, stage })).error?.message).toContain('Only closed or lost jobs')
    }
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('keeps success feedback off when the reopen write fails', async () => {
    mocks.transition.mockResolvedValue({ data: null, error: { message: 'Write rejected' } })
    expect((await reopen({ ...contact, stage: 'closed' })).error?.message).toBe('Write rejected')
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
