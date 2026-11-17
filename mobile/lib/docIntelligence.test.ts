import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ vision: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./anthropic', async (importOriginal) => ({ ...(await importOriginal<any>()), claudeVision: mock.vision }))
import { parseExpenseFromImage, parseLeadFromImage } from './docIntelligence'

// Fable 5 replies lead with a thinking block; the JSON is in the text block after it.
const reply = (json: object) => ({ content: [{ type: 'thinking', thinking: 'Reading the photo' }, { type: 'text', text: JSON.stringify(json) }] })

describe('native document scans read the text block', () => {
  it('receipt scan finds the text block after a thinking block', async () => {
    mock.vision.mockResolvedValue(reply({ description: 'Lumber', amount: 42.5, category: 'Materials', expense_date: '2026-11-16' }))
    await expect(parseExpenseFromImage('data:image/jpeg;base64,x')).resolves.toMatchObject({ description: 'Lumber', amount: 42.5 })
  })
  it('lead scan finds the text block after a thinking block', async () => {
    mock.vision.mockResolvedValue(reply({ name: 'Pat Smith', phone: '555 123 4567' }))
    await expect(parseLeadFromImage('data:image/jpeg;base64,x')).resolves.toMatchObject({ name: 'Pat Smith' })
  })
})
