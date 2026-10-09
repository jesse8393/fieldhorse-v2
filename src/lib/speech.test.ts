import { describe, it, expect } from 'vitest'
import { speechErrorFeedback } from './speech.ts'

describe('speechErrorFeedback', () => {
  it('stays quiet when the app aborted recognition itself', () => {
    expect(speechErrorFeedback('aborted')).toBeNull()
  })

  it('explains a blocked microphone', () => {
    expect(speechErrorFeedback('not-allowed')).toMatchObject({ title: 'Microphone blocked', tone: 'error' })
    expect(speechErrorFeedback('service-not-allowed')).toMatchObject({ title: 'Microphone blocked' })
  })

  it('treats silence as a gentle hint', () => {
    expect(speechErrorFeedback('no-speech')).toMatchObject({ tone: 'info' })
  })

  it('has a fallback for unknown codes', () => {
    expect(speechErrorFeedback('bad-grammar')).toMatchObject({ title: 'Voice stopped', tone: 'error' })
    expect(speechErrorFeedback(undefined)).toMatchObject({ title: 'Voice stopped' })
  })
})
