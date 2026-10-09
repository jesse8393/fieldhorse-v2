import { describe, expect, it } from 'vitest'
import { INPUT_LIMITS, claudeModelTraits, measureClaudeInput } from '../../netlify/functions/claude.js'

describe('Claude model family handling', () => {
  it('keeps the existing behaviour for the allowlisted models', () => {
    expect(claudeModelTraits('claude-fable-5')).toEqual({ isClaude5: true, disableThinking: false, thinkingOn: true })
    expect(claudeModelTraits('claude-sonnet-5')).toEqual({ isClaude5: true, disableThinking: true, thinkingOn: false })
    expect(claudeModelTraits('claude-haiku-4-5-20251001')).toEqual({ isClaude5: false, disableThinking: false, thinkingOn: false })
  })

  it('treats other Claude 5 ids by family, so a new ANTHROPIC_MODEL keeps the floor and effort pin', () => {
    for (const id of ['claude-fable-5-1', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-mythos-5-1']) {
      expect(claudeModelTraits(id)).toEqual({ isClaude5: true, disableThinking: false, thinkingOn: true })
    }
  })

  it('does not mistake older models for the 5 family', () => {
    for (const id of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', '', undefined]) {
      expect(claudeModelTraits(id).isClaude5).toBe(false)
    }
  })
})

describe('Claude input size', () => {
  it('counts system and message text, and images by block', () => {
    const size = measureClaudeInput({
      system: 'abcd',
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'x'.repeat(500_000) } },
            { type: 'text', text: 'Caption this' },
          ],
        },
      ],
    })
    expect(size).toEqual({ textChars: 4 + 5 + 12, imageBlocks: 1 })
  })

  it('counts system blocks and unknown blocks by size', () => {
    const doc = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'y'.repeat(100_000) } }
    const size = measureClaudeInput({
      system: [{ type: 'text', text: 'rules' }],
      messages: [{ role: 'user', content: [doc] }],
    })
    expect(size.imageBlocks).toBe(0)
    expect(size.textChars).toBeGreaterThan(INPUT_LIMITS.textChars)
  })

  it('lets a real vision request through and stops a filler prompt', () => {
    const vision = measureClaudeInput({
      system: 'x'.repeat(1_200),
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'z'.repeat(1_600_000) } }, { type: 'text', text: 'Extract this lead.' }] }],
    })
    expect(vision.textChars).toBeLessThanOrEqual(INPUT_LIMITS.textChars)
    expect(vision.imageBlocks).toBeLessThanOrEqual(INPUT_LIMITS.imageBlocks)

    const filler = measureClaudeInput({ system: 'x'.repeat(600_000), messages: [{ role: 'user', content: 'hi' }] })
    expect(filler.textChars).toBeGreaterThan(INPUT_LIMITS.textChars)
  })
})
