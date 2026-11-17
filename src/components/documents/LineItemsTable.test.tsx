// The proposal's line table prints a unit price only when quantity times it
// gives the line's amount (audit finding M-17).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProposalTemplate, mapItemsToScope } from './index'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/\n+/g, '\n')

function proposal(items: any[]) {
  const mapped = mapItemsToScope(items)
  return text(renderToStaticMarkup(
    <ProposalTemplate
      company={{ name: 'Parker Construction', estimate_template: 'classic' }}
      contact={{ id: 'q-1', name: 'Marco Castellanos', job_title: 'Driveway', amount: 0, proposal_status: 'sent' }}
      project={{ title: 'Driveway', address: '' }}
      scopeSections={mapped.scopeSections}
      upgrades={mapped.upgrades}
      pricing={{ baseTotal: mapped.baseTotal, upgradeTotal: mapped.upgradeTotal, discount: 0, taxRate: 0 }}
      status="sent"
    />
  ))
}

describe('the unit price on the proposal', () => {
  it('prints the rate when quantity times it is the amount', () => {
    const html = proposal([{ id: 'a', description: 'Excavate', qty: 1100, unit: 'sq ft', rate: 2, amount: 2200, sort_order: 0 }])
    expect(html).toContain('$2.00')
    expect(html).toContain('$2,200.00')
  })

  it('a lump sum line saved with rate 0 does not print $0.00', () => {
    const html = proposal([{ id: 'a', description: 'Demo and haul off', qty: 1, rate: 0, amount: 1513, sort_order: 0 }])
    expect(html).toContain('$1,513.00')
    expect(html).not.toMatch(/\$0\.00/)
  })

  it('1,100 sq ft at $9.875 prints $9.875, never $9.88 beside $10,862.50', () => {
    const html = proposal([{ id: 'a', description: 'Driveway, 4 in', qty: 1100, unit: 'sq ft', rate: 9.875, amount: 10862.5, sort_order: 0 }])
    expect(html).toContain('$10,862.50')
    expect(html).not.toContain('$9.88')
    expect(html).toContain('$9.875')
  })

  it('a line whose amount was edited away from quantity times rate prints no stale unit price', () => {
    const html = proposal([{ id: 'a', description: 'Pour', qty: 1, rate: 2000, amount: 12500, sort_order: 0 }])
    expect(html).toContain('$12,500.00')
    expect(html).not.toContain('$2,000.00')
  })
})
