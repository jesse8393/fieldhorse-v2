import { expect, test, type BrowserContext } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const COMPANY = 'Example Construction Company'
const EMAIL = 'office@exampleconstructioncompany.com'
const LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="440" height="140"><rect width="440" height="140" fill="#172A2D"/><text x="20" y="90" fill="white" font-size="42">EXAMPLE</text></svg>')
const items = [
  { id: 'line-1', user_id: 'qa-user-1', quote_id: 'q-quote', description: 'Concrete', notes: 'Grind the north landing and protect the entry doors.', qty: 1, rate: 1300, amount: 1300, sort_order: 0, is_optional: false, is_excluded: false },
  { id: 'line-2', user_id: 'qa-user-1', quote_id: 'q-quote', description: 'Steps', notes: 'Replace all six treads.', qty: 1, rate: 6450, amount: 6450, sort_order: 1, is_optional: false, is_excluded: false }
]

for (const template of ['classic', 'mint', 'slate', 'editorial', 'fieldhorse']) {
  test(`${template} customer preview preserves readable scope at phone widths`, async ({ context, page }) => {
    await signIn(context, { tables: {
      profiles: [{ user_id: 'qa-user-1', full_name: 'Example Owner', company_name: COMPANY, company_email: EMAIL, company_phone: '615 555 0100', estimate_template: template, logo_url: LOGO, onboarded_at: '2026-01-01', preferences: {} }],
      fh_quote_items: items
    } })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/quotes/q-quote/preview')
    const preview = page.getByRole('group', { name: 'Proposal preview' })
    await expect(preview.getByText('Grind the north landing and protect the entry doors.')).toBeVisible()
    await expect(preview.getByText('Replace all six treads.')).toBeVisible()
    await expect(preview.getByText('$7,750.00', { exact: true }).first()).toBeVisible()
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      const geometry = await preview.evaluate((root) => {
        const article = root.querySelector('article')!
        const rect = article.getBoundingClientRect()
        const copy = root.querySelector('.fh-doc-brand-copy')
        const logo = root.querySelector('.fh-doc-letterhead .fh-doc-mark')
        const cr = copy?.getBoundingClientRect()
        const lr = logo?.getBoundingClientRect()
        const wrappedMoney = Array.from(root.querySelectorAll('.fh-doc-item-row td[data-label]')).filter((cell) => {
          if (!cell.textContent?.includes('$')) return false
          const range = document.createRange()
          range.selectNodeContents(cell)
          return new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top))).size > 1
        }).length
        return {
          width: rect.width,
          scrollWidth: article.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
          copyWidth: cr?.width,
          wrappedMoney,
          overlap: cr && lr ? cr.left < lr.right && cr.right > lr.left && cr.top < lr.bottom && cr.bottom > lr.top : false
        }
      })
      expect(geometry.scrollWidth).toBeLessThanOrEqual(Math.ceil(geometry.width) + 1)
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1)
      expect(geometry.overlap).toBe(false)
      expect(geometry.wrappedMoney).toBe(0)
      if (template === 'mint') expect(geometry.copyWidth).toBeGreaterThan(200)
      await expect(preview.getByText('Replace all six treads.')).toBeVisible()
    }
    if (template === 'mint') await expect(preview.getByText(EMAIL).first()).toBeVisible()
  })
}

for (const mark of [
  { name: 'white transparent', fill: 'white', background: '', expected: [20, 20, 20, 255] },
  { name: 'dark transparent', fill: '#141414', background: '', expected: [242, 237, 228, 255] },
  { name: 'opaque', fill: 'white', background: '<rect width="440" height="140" fill="#172A2D"/>', expected: [23, 42, 45, 255] }
]) {
  test(`${mark.name} logo keeps a readable document surface`, async ({ context, page }) => {
    const logo = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="140">${mark.background}<text x="20" y="90" fill="${mark.fill}" font-size="42">EXAMPLE</text></svg>`)
    await signIn(context, { tables: {
      profiles: [{ user_id: 'qa-user-1', full_name: 'Example Owner', company_name: COMPANY, estimate_template: 'mint', logo_url: logo, onboarded_at: '2026-01-01', preferences: {} }],
      fh_quote_items: items
    } })
    await page.goto('/quotes/q-quote/preview')
    const image = page.getByRole('group', { name: 'Proposal preview' }).getByAltText(`${COMPANY} logo`)
    await expect(image).toHaveAttribute('src', /^data:image\/png/)
    const corner = await image.evaluate(async (element) => {
      const img = element as HTMLImageElement
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    })
    expect(corner).toEqual(mark.expected)
  })
}

// Isolated stateful delivery fixture: respect the actual PATCH predicates so a
// stale UI cannot silently overwrite a newer server status in these tests.
async function deliveryFixture(context: BrowserContext, { fail = false, raceStatus }: { fail?: boolean; raceStatus?: string } = {}) {
  const row = {
    id: 'q-quote', user_id: 'qa-user-1', client_id: 'cl-1', title: 'Delivery test proposal',
    status: 'draft', sent_at: null as string | null, job_id: null, origin_contact_id: null,
    amount: 7750, scope_text: null, terms_text: null, exclusions_text: null, expires_at: null,
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    approved_version_id: null as string | null,
    fh_clients: { id: 'cl-1', name: 'Jeff Roy', email: 'jeff@roy.com', phone: '555-0101' },
  }
  const writes: Array<{ url: string; payload: Record<string, unknown>; matched: boolean }> = []
  await signIn(context, { tables: { fh_quotes: [row], fh_quote_items: items } })
  await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      const single = request.headers().accept?.includes('vnd.pgrst.object')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? row : [row]) })
    }
    if (request.method() !== 'PATCH') return route.fallback()
    if (raceStatus) {
      row.status = raceStatus
      if (raceStatus === 'approved') row.approved_version_id = 'approved-version-1'
    }
    const url = new URL(request.url())
    const payload = request.postDataJSON() as Record<string, unknown>
    const matched = url.searchParams.get('id') === `eq.${row.id}`
      && url.searchParams.get('status') === `eq.${row.status}`
      && url.searchParams.get('job_id') === 'is.null' && row.job_id === null
    writes.push({ url: request.url(), payload, matched })
    if (fail) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Could not record delivery' }) })
    if (!matched) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    Object.assign(row, payload)
    // PostgreSQL serializes timestamptz with an offset, not necessarily Z.
    const confirmed = { ...row, sent_at: row.sent_at?.replace('Z', '+00:00') }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(confirmed) })
  })
  return { row, writes }
}

test('marking delivery confirms the stored status before reporting success', async ({ context, page }) => {
  const state = await deliveryFixture(context)
  await page.goto('/quotes/q-quote')
  await page.getByRole('button', { name: /^Mark as sent/ }).click()
  await expect(page.getByText('Quote marked as sent', { exact: true })).toBeVisible()
  await expect(page.locator('.fhqt-head').getByText('Sent', { exact: true })).toBeVisible()
  expect(state.writes).toHaveLength(1)
  expect(state.writes[0].matched).toBe(true)
  expect(state.writes[0].payload).toMatchObject({ status: 'sent', sent_at: expect.any(String) })
  await page.reload()
  await expect(page.locator('.fhqt-head').getByText('Sent', { exact: true })).toBeVisible()
})

test('a rejected delivery update keeps the draft and never reports success', async ({ context, page }) => {
  const state = await deliveryFixture(context, { fail: true })
  await page.goto('/quotes/q-quote')
  await page.getByRole('button', { name: /^Mark as sent/ }).click()
  await expect(page.getByText("Couldn't update the quote", { exact: true })).toBeVisible()
  await expect(page.getByText('Quote marked as sent', { exact: true })).toHaveCount(0)
  await expect(page.locator('.fhqt-head').getByText('Draft', { exact: true })).toBeVisible()
  expect(state.row.status).toBe('draft')
  expect(state.row.sent_at).toBeNull()
})

for (const currentStatus of ['approved', 'changes_requested']) {
  test(`a concurrent ${currentStatus} cannot be overwritten by a stale delivery acknowledgement`, async ({ context, page }) => {
    const state = await deliveryFixture(context, { raceStatus: currentStatus })
    await page.goto('/quotes/q-quote')
    await expect(page.locator('.fhqt-head').getByText('Draft', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Mark as sent/ }).click()
    await expect(page.getByText('This quote has changed. Review its current status before marking it as sent.', { exact: true })).toBeVisible()
    await expect(page.getByText('Quote marked as sent', { exact: true })).toHaveCount(0)
    await expect(page.locator('.fhqt-head').getByText(currentStatus === 'approved' ? 'Approved' : 'Changes requested', { exact: true })).toBeVisible()
    expect(state.row.status).toBe(currentStatus)
    expect(state.row.sent_at).toBeNull()
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].matched).toBe(false)
    expect(new URL(state.writes[0].url).searchParams.get('status')).toBe('eq.draft')
  })
}
