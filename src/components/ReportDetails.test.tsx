// formats-9: a follow up date the AI read from a field report prints the
// way the app prints dates ("Nov 20, 2026"), never as raw "2026-11-20".
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReportDetails from './ReportDetails.tsx'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n')

function render(followUp: unknown) {
  return text(renderToStaticMarkup(
    <ReportDetails report={{ id: 'n1', text: 'Forms set.', parsed: { summary: 'Forms set.', follow_up_date: followUp } } as any} />
  ))
}

describe('ReportDetails follow up date', () => {
  it('prints a date only value as a calendar date', () => {
    const out = render('2026-11-20')
    expect(out).toContain('Follow up: Nov 20, 2026')
    expect(out).not.toContain('2026-11-20')
  })

  it('keeps words the AI wrote that are not a date', () => {
    expect(render('next Friday')).toContain('Follow up: next Friday')
  })
})
