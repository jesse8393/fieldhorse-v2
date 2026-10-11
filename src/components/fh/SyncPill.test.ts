import { describe, expect, it } from 'vitest'
import { syncPillState } from './syncPillState.ts'

describe('syncPillState', () => {
  it('is Synced when online with nothing queued', () => {
    expect(syncPillState({ online: true, queued: 0 })).toMatchObject({
      status: 'synced',
      queued: 0,
      label: 'Synced',
      detail: null
    })
  })

  it('is Syncing when online with work still queued', () => {
    expect(syncPillState({ online: true, queued: 2 })).toMatchObject({
      status: 'syncing',
      queued: 2,
      label: 'Syncing',
      detail: null,
      spoken: 'Syncing 2 changes.'
    })
  })

  it('is Offline with the queued count when the phone has no signal', () => {
    const state = syncPillState({ online: false, queued: 3 })
    expect(state).toMatchObject({ status: 'offline', queued: 3, label: 'Offline', detail: '3 queued' })
    expect(state.spoken).toBe('Offline. 3 changes saved on this phone, they will sync when you are back.')
  })

  it('is Offline without a count when nothing is queued', () => {
    expect(syncPillState({ online: false, queued: 0 })).toMatchObject({ status: 'offline', queued: 0, detail: null })
  })

  it('uses the singular for one change', () => {
    expect(syncPillState({ online: false, queued: 1 }).spoken).toContain('1 change saved')
    expect(syncPillState({ online: true, queued: 1 }).spoken).toBe('Syncing 1 change.')
  })

  it('treats a negative, fractional or missing count as whole and non negative', () => {
    expect(syncPillState({ online: true, queued: -4 }).status).toBe('synced')
    expect(syncPillState({ online: true, queued: Number.NaN }).status).toBe('synced')
    expect(syncPillState({ online: false, queued: 2.7 }).queued).toBe(2)
  })

  it('never writes a dash in anything a person reads', () => {
    for (const online of [true, false]) {
      for (const queued of [0, 1, 5]) {
        const { label, detail, spoken } = syncPillState({ online, queued })
        expect(`${label} ${detail ?? ''} ${spoken}`).not.toMatch(/[‐-―-]/)
      }
    }
  })
})
