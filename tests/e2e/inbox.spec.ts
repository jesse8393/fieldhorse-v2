// The Inbox (docs/design/2026-10-redesign/SPEC.md, section 9.8, decision
// D9): it shows up in the dock and the sidebar only when the company's
// messaging engine is on, lists conversations with a Draft ready chip, and
// opens a thread where an agent's draft is sent only by the person's tap.
// Every test runs against the mock, so nothing is ever really sent.
import { expect, test, type Page } from '@playwright/test'
import { signIn, type SignInOptions } from './helpers/signIn.ts'
import { rpcCalls } from './helpers/rpcCalls.ts'

// The mock company is in Tennessee, so the phone runs on Central time and
// the clock is fixed: Saturday, October 10, 2026, 10:00 am.
test.use({ timezoneId: 'America/Chicago' })
const MORNING = new Date('2026-10-10T15:00:00Z')

const ENGINE_ON = { fh_org_settings: [{ engine_enabled: true }] }

// Four conversations. Priya wrote this morning and has a draft waiting,
// Marcus wrote yesterday, Tessa has a reply that is held back, and Gus
// wrote in September. Times are UTC; the phone shows them in Central.
function conversation(partial: Record<string, unknown>) {
  return {
    org_id: 'org-1',
    company_name: null,
    last_channel: 'sms',
    unread_count: 0,
    pending_drafts: 0,
    held_messages: 0,
    starred: false,
    status: 'open',
    snoozed_until: null,
    email: null,
    phone: '555-0142',
    ...partial
  }
}

const INBOX = [
  conversation({
    conversation_id: 'conv-priya', client_id: 'cl-priya', client_name: 'Priya Rangarajan',
    last_preview: 'Can we push to 11:30? Daycare pickup ran long.', last_message_at: '2026-10-10T13:14:00Z',
    unread_count: 1, pending_drafts: 1, latest_record: 'quote', latest_record_id: 'q-priya', latest_stage: 'job'
  }),
  conversation({
    conversation_id: 'conv-marcus', client_id: 'cl-marcus', client_name: 'Marcus Bell',
    last_preview: 'Thanks, the crew did great work.', last_message_at: '2026-10-09T21:30:00Z',
    latest_record: 'job', latest_record_id: 'c-marcus', latest_stage: 'job', last_channel: 'email', email: 'marcus@example.com'
  }),
  conversation({
    conversation_id: 'conv-tessa', client_id: 'cl-tessa', client_name: 'Tessa Holloway',
    last_preview: 'We can start Monday if the weather holds.', last_message_at: '2026-10-07T15:00:00Z',
    held_messages: 1, latest_record: 'lead', latest_record_id: 'l-tessa', latest_stage: null
  }),
  conversation({
    conversation_id: 'conv-gus', client_id: 'cl-gus', client_name: 'Gus Okafor',
    last_preview: 'Still thinking about the retaining wall.', last_message_at: '2026-09-20T15:00:00Z',
    latest_record: 'job', latest_record_id: 'c-gus', latest_stage: 'closed'
  })
]

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(MORNING)
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

async function start(
  context: Parameters<typeof signIn>[0],
  page: Page,
  path: string,
  options: SignInOptions = {}
) {
  await signIn(context, options)
  await open(page, path)
}

test.describe('the engine switch on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone dock')

  test('Schedule keeps the fifth dock slot while the engine is off', async ({ context, page }) => {
    await start(context, page, '/')
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })

  test('Schedule keeps the slot when the settings row says the engine is off', async ({ context, page }) => {
    await start(context, page, '/', { tables: { fh_org_settings: [{ engine_enabled: false }] } })
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })

  test('Inbox takes the fifth slot once the engine is on', async ({ context, page }) => {
    await start(context, page, '/', { tables: ENGINE_ON })
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Inbox' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Schedule' })).toHaveCount(0)
    for (const label of ['Today', 'Jobs', 'Money']) {
      await expect(dock.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('a crew member keeps Schedule even with the engine on, because the Inbox is not theirs', async ({ context, page }) => {
    await start(context, page, '/crew', { tables: ENGINE_ON, role: 'crew' })
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })
})

test.describe('the engine switch on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop sidebar')

  test('the sidebar lists Inbox after Money only when the engine is on', async ({ context, page }) => {
    await start(context, page, '/', { tables: ENGINE_ON })
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: 'Inbox' })).toBeVisible()
    const labels = await nav.getByRole('link').allInnerTexts()
    expect(labels.map((l) => l.trim())).toEqual(['Today', 'Schedule', 'Jobs', 'Money', 'Inbox', 'More'])
  })

  test('the sidebar has no Inbox while the engine is off', async ({ context, page }) => {
    await start(context, page, '/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })
})

test.describe('the Inbox list', () => {
  test('lists the conversations with their chips when the engine is on', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()

    const rows = page.locator('.fhi-rows > li')
    await expect(rows).toHaveCount(4)
    // Newest first.
    await expect(rows.nth(0)).toContainText('Priya Rangarajan')
    await expect(rows.nth(1)).toContainText('Marcus Bell')
    await expect(rows.nth(3)).toContainText('Gus Okafor')

    const priya = rows.nth(0)
    await expect(priya).toContainText('Can we push to 11:30?')
    await expect(priya).toContainText('8:14 am')
    await expect(priya.getByText('Draft ready', { exact: true })).toBeVisible()
    await expect(priya.getByText('Quote', { exact: true })).toBeVisible()
    // An unread conversation says so in words as well as with a dot.
    await expect(priya.getByText('Unread', { exact: false })).toHaveCount(1)

    await expect(rows.nth(1)).toContainText('Yesterday')
    await expect(rows.nth(1).getByText('Job', { exact: true })).toBeVisible()
    await expect(rows.nth(1).getByText('Draft ready')).toHaveCount(0)
    await expect(rows.nth(3)).toContainText('Sep 20')
    await expect(page.getByText('Draft ready', { exact: true })).toHaveCount(1)
  })

  test('a conversation with a held reply says so on its row', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    const tessa = page.locator('.fhi-rows > li').filter({ hasText: 'Tessa Holloway' })
    await expect(tessa.getByText('Held', { exact: true })).toBeVisible()
    await expect(page.locator('.fhi-rows > li').filter({ hasText: 'Marcus Bell' }).getByText('Held')).toHaveCount(0)
  })

  test('the list has no gold button', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    await expect(page.locator('.fhi-rows > li')).toHaveCount(4)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
  })

  test('an empty inbox says so in one line', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: ENGINE_ON })
    await expect(page.getByText('No conversations yet.', { exact: true })).toBeVisible()
  })

  test('with the engine off it explains itself and points to Settings', async ({ context, page }, testInfo) => {
    await start(context, page, '/inbox')
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
    await expect(page.getByText('Inbox turns on with messaging', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
    await expect(page.locator('.fhi-rows')).toHaveCount(0)
    if (testInfo.project.name.startsWith('mobile')) {
      // And the dock still has Schedule, not Inbox.
      const dock = page.getByRole('navigation', { name: 'Primary' })
      await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
      await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
    }
  })

  test('a manager is told to ask an owner when the engine is off', async ({ context, page }) => {
    await start(context, page, '/inbox', { role: 'manager' })
    await expect(page.getByText('Inbox turns on with messaging', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveCount(0)
    await expect(page.getByText('Ask an owner or an admin to turn it on.')).toBeVisible()
  })

  test('field roles cannot open the Inbox', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX }, role: 'foreman' })
    await expect(page).toHaveURL(/\/crew$/)
    await expect(page.getByText('Priya Rangarajan')).toHaveCount(0)
  })

  test('the Inbox lights up in the dock and opens a conversation from a row', async ({ context, page }, testInfo) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    if (testInfo.project.name.startsWith('mobile')) {
      const dock = page.getByRole('navigation', { name: 'Primary' })
      await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page')
    }
    await page.locator('.fhi-rows > li').first().getByRole('link').click()
    await expect(page).toHaveURL(/\/inbox\/conv-priya$/)
  })

  test('on a desktop the list sits beside the open conversation', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Two columns need a desktop')
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    const list = page.getByRole('complementary', { name: 'Conversations' })
    await expect(list).toBeVisible()
    await expect(list.locator('.fhi-rows > li')).toHaveCount(4)
    await expect(page.getByText('Choose a conversation to read it.')).toBeVisible()

    await list.locator('.fhi-rows > li').nth(1).getByRole('link').click()
    await expect(page).toHaveURL(/\/inbox\/conv-marcus$/)
    // The list stays while the conversation opens beside it.
    await expect(list.locator('.fhi-rows > li')).toHaveCount(4)
    const box = await list.boundingBox()
    expect(box?.x).toBeGreaterThan(200)
    expect(box?.width).toBeLessThan(480)
  })
})

// ---- A thread ---------------------------------------------------------------

function message(partial: Record<string, unknown>) {
  return {
    org_id: 'org-1', conversation_id: 'conv-priya', client_id: 'cl-priya', channel: 'sms', subject: null,
    direction: 'inbound', status: 'received', read_at: null, hold_reason: null, sent_by_kind: 'contact',
    agent_run_id: null, sent_at: null, call_status: null, ...partial
  }
}

const MESSAGES = [
  message({
    id: 'm1', direction: 'outbound', status: 'sent', sent_by_kind: 'user', created_at: '2026-10-09T21:48:00Z',
    body: "Hi Priya, Jesse with Parker Construction. We're set for Thursday at 11:00 to look at the patio cover."
  }),
  message({ id: 'm2', created_at: '2026-10-09T22:02:00Z', body: 'Perfect, thank you!' }),
  message({ id: 'm3', created_at: '2026-10-10T13:14:00Z', body: 'Can we push to 11:30? Daycare pickup ran long.' })
]

const DRAFT_TEXT = "Of course, 11:30 works. I'll bring a fan option so we can see where the power run would go."
const RUNS = [
  {
    id: 'run-1', agent_id: 'agent-1', conversation_id: 'conv-priya', client_id: 'cl-priya', status: 'proposed',
    created_at: '2026-10-10T13:15:00Z', proposal: { channel: 'sms', body: DRAFT_TEXT }
  }
]

const JOB = {
  id: 'c-priya', user_id: 'qa-user-1', client_id: 'cl-priya', stage: 'quote', name: 'Priya Rangarajan',
  job_title: 'Rangarajan patio cover', amount: 14800, created_at: '2026-09-20T12:00:00Z',
  updated_at: '2026-10-09T12:00:00Z', fh_clients: { name: 'Priya Rangarajan', phone: '555-0142', email: null }
}

const THREAD = { ...ENGINE_ON, fh_v_inbox: INBOX, fh_messages: MESSAGES, fh_agent_runs: RUNS, fh_contacts: [JOB] }

async function openThread(
  context: Parameters<typeof signIn>[0],
  page: Page,
  tables: SignInOptions['tables'] = THREAD,
  id = 'conv-priya'
) {
  await start(context, page, `/inbox/${id}`, { tables })
  await expect(page.locator('.fhi-thread')).toBeVisible({ timeout: 30_000 })
}

const draftBox = (page: Page) => page.getByRole('textbox', { name: 'Draft reply' })
const sendDraft = (page: Page) => page.getByRole('button', { name: 'Send draft reply', exact: true })

test.describe('a thread', () => {
  test('shows the name, the job chip, the bubbles under day labels and the draft', async ({ context, page }) => {
    await openThread(context, page)
    const thread = page.locator('.fhi-thread')
    await expect(thread.getByRole('heading', { name: 'Priya Rangarajan' })).toBeVisible()
    await expect(thread.getByRole('link', { name: /Rangarajan patio cover/ })).toHaveAttribute('href', '/jobs/c-priya')
    await expect(thread.getByRole('link', { name: 'Call Priya Rangarajan' })).toHaveAttribute('href', 'tel:555-0142')

    await expect(thread.getByText('Yesterday', { exact: true })).toBeVisible()
    await expect(thread.getByText('Today', { exact: true })).toBeVisible()
    await expect(thread.getByText('Perfect, thank you!')).toBeVisible()
    await expect(thread.getByText('4:48 pm', { exact: true })).toBeVisible()
    await expect(thread.getByText('8:14 am', { exact: true })).toBeVisible()

    // Sent bubbles sit on the right, received on the left.
    const sent = thread.locator('.fhi-msg.is-out').first()
    const received = thread.locator('.fhi-msg.is-in').first()
    const [a, b] = [await sent.boundingBox(), await received.boundingBox()]
    expect(a && b && a.x > b.x).toBe(true)

    await expect(draftBox(page)).toHaveValue(DRAFT_TEXT)
    await expect(sendDraft(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  })

  test('opening it marks the conversation read once and not again on later renders', async ({ context, page }) => {
    await openThread(context, page)
    await expect.poll(() => rpcCalls(context, 'fh_conversation_mark_read').length).toBe(1)
    expect(rpcCalls(context, 'fh_conversation_mark_read')[0].body).toEqual({ p_conversation_id: 'conv-priya' })
    // Typing, refocusing the window and waiting out a refetch re-render the screen.
    await page.getByRole('textbox', { name: 'Write a reply' }).fill('Thursday works')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(1500)
    expect(rpcCalls(context, 'fh_conversation_mark_read')).toHaveLength(1)
  })

  test('nothing is sent just by opening a thread with a draft in it', async ({ context, page }) => {
    await openThread(context, page)
    await expect(draftBox(page)).toBeVisible()
    await page.waitForTimeout(1000)
    expect(rpcCalls(context, 'fh_agent_run_approve')).toHaveLength(0)
    expect(rpcCalls(context, 'fh_send_message')).toHaveLength(0)
    expect(rpcCalls(context, 'fh_agent_run_reject')).toHaveLength(0)
  })

  test('Send approves the draft with the text as edited, in one call', async ({ context, page }) => {
    await openThread(context, page)
    await draftBox(page).fill('Of course, 11:30 works. See you then.')
    await sendDraft(page).click()
    await expect.poll(() => rpcCalls(context, 'fh_agent_run_approve').length).toBe(1)
    expect(rpcCalls(context, 'fh_agent_run_approve')[0].body).toEqual({
      p_agent_run_id: 'run-1',
      p_body: 'Of course, 11:30 works. See you then.'
    })
    // The draft is gone and what went out is in the thread.
    await expect(page.getByRole('textbox', { name: 'Draft reply' })).toHaveCount(0)
    await expect(page.locator('.fhi-thread').getByText('Of course, 11:30 works. See you then.')).toBeVisible()
    expect(rpcCalls(context, 'fh_send_message')).toHaveLength(0)
  })

  test('sending the draft untouched sends the proposed words', async ({ context, page }) => {
    await openThread(context, page)
    await sendDraft(page).click()
    await expect.poll(() => rpcCalls(context, 'fh_agent_run_approve').length).toBe(1)
    expect(rpcCalls(context, 'fh_agent_run_approve')[0].body.p_body).toBe(DRAFT_TEXT)
  })

  test('a double tap on Send makes exactly one call', async ({ context, page }) => {
    await openThread(context, page)
    await draftBox(page).fill('Double tap test')
    await sendDraft(page).dblclick()
    await page.waitForTimeout(1200)
    expect(rpcCalls(context, 'fh_agent_run_approve')).toHaveLength(1)
  })

  test('Discard rejects the draft and the panel goes away', async ({ context, page }) => {
    await openThread(context, page)
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect.poll(() => rpcCalls(context, 'fh_agent_run_reject').length).toBe(1)
    expect(rpcCalls(context, 'fh_agent_run_reject')[0].body).toEqual({ p_agent_run_id: 'run-1' })
    await expect(page.getByRole('textbox', { name: 'Draft reply' })).toHaveCount(0)
    expect(rpcCalls(context, 'fh_agent_run_approve')).toHaveLength(0)
    expect(rpcCalls(context, 'fh_send_message')).toHaveLength(0)
  })

  test('a failed approval keeps the edits and says nothing was confirmed', async ({ context, page }) => {
    await openThread(context, page)
    let attempts = 0
    await context.route('**/rest/v1/rpc/fh_agent_run_approve', (route) => {
      attempts += 1
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'run already handled' }) })
    })
    // Hold the thread's next read, so the check after the failure is still
    // running when the toast shows.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let hold = false
    let refetches = 0
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_messages'), async (route) => {
      if (hold) {
        refetches += 1
        await gate
      }
      await route.fallback()
    })
    await draftBox(page).fill('My edit that must survive')
    hold = true
    await sendDraft(page).click()
    await expect(page.getByText("We couldn't confirm this went out.")).toBeVisible()
    await expect(page.getByText('Check the thread before sending again.')).toBeVisible()
    await expect(draftBox(page)).toHaveValue('My edit that must survive')
    // The thread is read again after the failure, and Send waits for it.
    await expect.poll(() => refetches).toBeGreaterThan(0)
    await expect(sendDraft(page)).toBeDisabled()
    release()
    // Then the button is usable again for a second try.
    await expect(sendDraft(page)).toBeEnabled()
    expect(attempts).toBe(1)
  })

  test('the composer sends through fh_send_message, once, and clears itself', async ({ context, page }) => {
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    const field = page.getByRole('textbox', { name: 'Write a reply' })
    await field.fill('Thursday at 11:30 it is.')
    await page.getByRole('button', { name: 'Send reply' }).dblclick()
    await expect.poll(() => rpcCalls(context, 'fh_send_message').length).toBe(1)
    expect(rpcCalls(context, 'fh_send_message')[0].body).toEqual({
      p_body: 'Thursday at 11:30 it is.',
      p_channel: 'sms',
      p_client_id: 'cl-priya'
    })
    await expect(field).toHaveValue('')
    await expect(page.locator('.fhi-thread').getByText('Thursday at 11:30 it is.')).toBeVisible()
    await page.waitForTimeout(800)
    expect(rpcCalls(context, 'fh_send_message')).toHaveLength(1)
  })

  test('the composer will not send an empty reply', async ({ context, page }) => {
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Write a reply' }).fill('   ')
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    expect(rpcCalls(context, 'fh_send_message')).toHaveLength(0)
  })

  test('a held reply says why in words and never looks sent', async ({ context, page }) => {
    const held = message({
      id: 'm-held', direction: 'outbound', status: 'queued', sent_by_kind: 'user',
      hold_reason: 'outside_send_window', created_at: '2026-10-10T14:30:00Z', body: 'Great, see you at 11:30 on Thursday.'
    })
    await openThread(context, page, { ...THREAD, fh_messages: [...MESSAGES, held], fh_agent_runs: [] })
    const bubble = page.locator('.fhi-msg.is-held')
    await expect(bubble).toHaveCount(1)
    await expect(bubble.getByText('Held: outside sending hours')).toBeVisible()
    await expect(bubble.getByText('Great, see you at 11:30 on Thursday.')).toBeVisible()
    // No send time under it, and it is not drawn as a sent bubble.
    await expect(bubble.getByText(/\d:\d\d (am|pm)/)).toHaveCount(0)
    await expect(page.locator('.fhi-msg.is-out.is-sent').filter({ hasText: 'Great, see you at 11:30' })).toHaveCount(0)
  })

  test('a held reason it does not know reads Held for review', async ({ context, page }) => {
    const held = message({
      id: 'm-held', direction: 'outbound', status: 'held', sent_by_kind: 'agent',
      hold_reason: 'zodiac_sign_mismatch', created_at: '2026-10-10T14:30:00Z', body: 'Held body'
    })
    await openThread(context, page, { ...THREAD, fh_messages: [...MESSAGES, held], fh_agent_runs: [] })
    await expect(page.locator('.fhi-msg.is-held').getByText('Held for review', { exact: true })).toBeVisible()
  })

  test('the draft Send is the only gold button, and a thread with no draft has none', async ({ context, page }) => {
    await openThread(context, page)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(1)
    await expect(page.locator('.fhc-btn--primary')).toHaveText('Send')
    await expect(page.locator('.fhc-btn--primary')).toHaveAccessibleName('Send draft reply')
  })

  test('a thread with no draft has no draft panel and no gold', async ({ context, page }) => {
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    await expect(page.getByText('Draft reply')).toHaveCount(0)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
  })

  test('the Draft ready chip leaves the list once the draft is sent', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Needs the list beside the thread')
    await openThread(context, page)
    const list = page.getByRole('complementary', { name: 'Conversations' })
    await expect(list.getByText('Draft ready', { exact: true })).toBeVisible()
    await sendDraft(page).click()
    await expect(list.getByText('Draft ready', { exact: true })).toHaveCount(0)
  })

  test('a phone thread brings its own header and hides the dock', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone only')
    await openThread(context, page)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open workspace menu' })).toBeHidden()
    await page.getByRole('link', { name: 'Back to inbox' }).click()
    await expect(page).toHaveURL(/\/inbox$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  })

  test('on a desktop the thread opens beside the list and nothing floats over Send', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop only')
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    const list = page.getByRole('complementary', { name: 'Conversations' })
    await expect(list.getByText('Marcus Bell')).toBeVisible()

    // No capture button floats over a desktop page any more (PHASE8_PLAN.md
    // Task 13, D33): the one Capture control is the sidebar row.
    const sidebar = page.locator('.fh-glass-header')
    await expect(sidebar.getByRole('button', { name: /^Capture/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Capture/ })).toHaveCount(1)
    await expect(page.locator('.fh-fab')).toHaveCount(0)

    // Send is on screen and nothing covers it: the topmost element at its
    // middle and at four points around it is Send itself.
    const send = page.getByRole('button', { name: 'Send reply' })
    await expect(send).toBeVisible()
    await expect(send).toBeInViewport()
    const covered = await send.evaluate((button) => {
      const r = button.getBoundingClientRect()
      const points = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]
      return points
        .map(([fx, fy]) => document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy))
        .filter((hit) => !hit || !button.contains(hit))
        .map((hit) => (hit ? `${hit.tagName.toLowerCase()} ${hit.getAttribute('class') ?? ''}`.trim() : 'nothing'))
    })
    expect(covered).toEqual([])

    // With nothing in the corner, the composer no longer stops short of it:
    // Send ends on the same right edge as the messages above it.
    const [sendBox, bubbleBox] = await Promise.all([
      send.boundingBox(),
      page.locator('.fhi-msg.is-out .fhi-bubble').first().boundingBox()
    ])
    expect(Math.abs((sendBox!.x + sendBox!.width) - (bubbleBox!.x + bubbleBox!.width))).toBeLessThanOrEqual(1)
  })
})

// ---- Sends exactly once, only when tapped, only when online (Phase 8, Task 11)

/** Every Growth Engine function the mock recorded for this context. */
const engineCalls = (context: Parameters<typeof signIn>[0]) => rpcCalls(context).filter((call) => call.name.startsWith('fh_'))

const replyField = (page: Page) => page.getByRole('textbox', { name: 'Write a reply' })

// A stand in for the browser's SpeechRecognition. say() delivers a final
// result the way the browser does, through onresult. A late result goes to
// the handler the recognizer had when it started, as a result already in
// flight when the person tapped Send would.
async function stubDictation(context: Parameters<typeof signIn>[0]) {
  await context.addInitScript(() => {
    type Handler = ((event?: unknown) => void) | null
    class FakeRecognition {
      continuous = false
      interimResults = false
      lang = ''
      onresult: Handler = null
      onend: Handler = null
      onerror: Handler = null
      private atStart: Handler = null
      start() {
        this.atStart = this.onresult
        ;(window as unknown as { __speech: FakeRecognition }).__speech = this
      }
      stop() { /* a real recognizer may still deliver a final result after this */ }
      abort() { this.onend?.() }
      say(text: string, late = false) {
        const handler = late ? this.atStart : this.onresult
        const result = Object.assign([{ transcript: text }], { isFinal: true })
        handler?.({ resultIndex: 0, results: [result] })
      }
    }
    const w = window as unknown as Record<string, unknown>
    w.SpeechRecognition = FakeRecognition
    w.webkitSpeechRecognition = FakeRecognition
  })
}

async function say(page: Page, text: string, late = false) {
  await page.evaluate(([words, isLate]) => {
    (window as unknown as { __speech?: { say: (t: string, l: boolean) => void } }).__speech?.say(words as string, isLate as boolean)
  }, [text, late] as const)
}

test.describe('sending exactly once, only when tapped and online', () => {
  test('offline, Send makes no call, then or after the signal comes back', async ({ context, page }) => {
    await openThread(context, page)
    await expect(draftBox(page)).toHaveValue(DRAFT_TEXT)
    await expect.poll(() => rpcCalls(context, 'fh_conversation_mark_read').length).toBe(1)
    await replyField(page).fill('Thursday at 11:30 it is.')
    const before = engineCalls(context).length

    await context.setOffline(true)
    await page.getByRole('button', { name: 'Send reply' }).click()
    await sendDraft(page).click()
    await page.waitForTimeout(800)
    expect(engineCalls(context)).toHaveLength(before)

    await context.setOffline(false)
    await page.waitForTimeout(2500)
    expect(engineCalls(context)).toHaveLength(before)
    expect(rpcCalls(context, 'fh_send_message')).toHaveLength(0)
    expect(rpcCalls(context, 'fh_agent_run_approve')).toHaveLength(0)
  })

  test('offline, Send says nothing was sent and keeps the words', async ({ context, page }) => {
    await openThread(context, page)
    await replyField(page).fill('Thursday at 11:30 it is.')
    await draftBox(page).fill('Of course. See you at 11:30.')
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText('No signal. Nothing was sent.').first()).toBeVisible()
    await expect(replyField(page)).toHaveValue('Thursday at 11:30 it is.')
    await sendDraft(page).click()
    await expect(page.getByText('No signal. Nothing was sent.').first()).toBeVisible()
    await expect(draftBox(page)).toHaveValue('Of course. See you at 11:30.')
    // Both stay ready for when the signal is back.
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeEnabled()
    await expect(sendDraft(page)).toBeEnabled()
    await context.setOffline(false)
  })

  test('a dictation result that lands after Send does not refill the composer', async ({ context, page }) => {
    await stubDictation(context)
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    const mic = page.getByRole('button', { name: 'Dictate a reply' })
    await mic.click()
    await expect(mic).toHaveAttribute('aria-pressed', 'true')
    await say(page, 'Thursday works for us')
    await expect(replyField(page)).toHaveValue('Thursday works for us')

    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect.poll(() => rpcCalls(context, 'fh_send_message').length).toBe(1)
    expect(rpcCalls(context, 'fh_send_message')[0].body.p_body).toBe('Thursday works for us')
    await expect(replyField(page)).toHaveValue('')

    // The recognizer delivers one more result after the send.
    await say(page, 'and bring the fan', true)
    await page.waitForTimeout(300)
    await expect(replyField(page)).toHaveValue('')
    // The label never changes; the pressed state says whether it listens.
    await expect(mic).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Stop dictating' })).toHaveCount(0)
  })

  test('the mic and Send wait while a reply is going out', async ({ context, page }) => {
    await stubDictation(context)
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    await context.route('**/rest/v1/rpc/fh_send_message', async (route) => {
      await gate
      await route.fallback()
    })
    const mic = page.getByRole('button', { name: 'Dictate a reply' })
    await mic.click()
    await say(page, 'See you Thursday')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(mic).toBeDisabled()
    await expect(mic).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeDisabled()
    // A result that arrives mid send is ignored too.
    await say(page, 'stray words', true)
    release()
    await expect.poll(() => rpcCalls(context, 'fh_send_message').length).toBe(1)
    await expect(replyField(page)).toHaveValue('')
    await expect(mic).toBeEnabled()
    await expect(replyField(page)).toBeFocused()
  })

  test('a draft whose words sit under keys it does not know shows no draft', async ({ context, page }) => {
    const runs = [{ ...RUNS[0], proposal: { channel: 'sms', reply_text: 'Of course, 11:30 works.', rationale: 'The customer asked to move the visit.' } }]
    await openThread(context, page, { ...THREAD, fh_agent_runs: runs })
    const thread = page.locator('.fhi-thread')
    await expect(thread.getByText('Daycare pickup ran long.')).toBeVisible()
    await expect(thread.getByText('Draft reply')).toHaveCount(0)
    await expect(thread.getByText('Of course, 11:30 works.')).toHaveCount(0)
    await expect(thread.getByText('The customer asked to move the visit.')).toHaveCount(0)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
  })

  test('a reply with a status it does not know reads Not sent yet', async ({ context, page }) => {
    const odd = message({
      id: 'm-odd', direction: 'outbound', status: 'accepted', sent_by_kind: 'user',
      created_at: '2026-10-10T14:30:00Z', body: 'On my way at 11:30.'
    })
    const stamped = message({
      id: 'm-stamped', direction: 'outbound', status: 'accepted', sent_by_kind: 'user',
      created_at: '2026-10-10T14:40:00Z', sent_at: '2026-10-10T14:40:05Z', body: 'Gate code is 4412.'
    })
    await openThread(context, page, { ...THREAD, fh_messages: [...MESSAGES, odd, stamped], fh_agent_runs: [] })
    const bubble = page.locator('.fhi-msg').filter({ hasText: 'On my way at 11:30.' })
    await expect(bubble.getByText('Not sent yet', { exact: true })).toBeVisible()
    await expect(bubble.getByText(/\d:\d\d (am|pm)/)).toHaveCount(0)
    await expect(bubble).not.toHaveClass(/is-sent/)
    // A send time on file is proof enough that it went out.
    const sent = page.locator('.fhi-msg').filter({ hasText: 'Gate code is 4412.' })
    await expect(sent).toHaveClass(/is-sent/)
    await expect(sent.getByText('9:40 am', { exact: true })).toBeVisible()
  })

  test('switching from one conversation to another on a phone clears the composer', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone only')
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    await replyField(page).fill('For Priya only')
    // A link from elsewhere in the app opens Marcus without leaving the thread screen.
    await page.evaluate(() => {
      history.pushState({}, '', '/inbox/conv-marcus')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.locator('.fhi-thread').getByRole('heading', { name: 'Marcus Bell' })).toBeVisible()
    await expect(replyField(page)).toHaveValue('')
  })

  test('a conversation from another company says so and offers no actions', async ({ context, page }) => {
    const other = conversation({
      org_id: 'org-2', conversation_id: 'conv-other', client_id: 'cl-other', client_name: 'Dana Whitfield',
      last_preview: 'Is the deck still on?', last_message_at: '2026-10-10T12:00:00Z', unread_count: 1, pending_drafts: 1
    })
    const theirs = message({ org_id: 'org-2', id: 'o1', conversation_id: 'conv-other', client_id: 'cl-other', created_at: '2026-10-10T12:00:00Z', body: 'Is the deck still on?' })
    const theirRun = { ...RUNS[0], id: 'run-other', org_id: 'org-2', conversation_id: 'conv-other', client_id: 'cl-other' }
    await openThread(context, page, {
      ...THREAD,
      fh_v_inbox: [...INBOX, other],
      fh_messages: [...MESSAGES, theirs],
      fh_agent_runs: [...RUNS, theirRun]
    }, 'conv-other')
    const thread = page.locator('.fhi-thread')
    await expect(thread.getByText('Not in this company', { exact: true })).toBeVisible()
    await expect(thread.getByText('Is the deck still on?')).toHaveCount(0)
    await expect(replyField(page)).toHaveCount(0)
    await expect(sendDraft(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Dictate a reply' })).toHaveCount(0)
    await expect(thread.getByRole('link', { name: /^Call / })).toHaveCount(0)
    await page.waitForTimeout(800)
    // Not even marked read.
    expect(engineCalls(context)).toHaveLength(0)
  })

  test('an email reply goes out under the latest subject', async ({ context, page }) => {
    const mail = [
      message({ id: 'e1', conversation_id: 'conv-marcus', client_id: 'cl-marcus', channel: 'email', subject: 'Deck estimate', created_at: '2026-10-01T15:00:00Z', body: 'Can you quote the deck?' }),
      message({ id: 'e2', conversation_id: 'conv-marcus', client_id: 'cl-marcus', channel: 'email', subject: 'Final walkthrough', created_at: '2026-10-09T21:30:00Z', body: 'Thanks, the crew did great work.' })
    ]
    await openThread(context, page, { ...THREAD, fh_messages: mail, fh_agent_runs: [] }, 'conv-marcus')
    await expect(page.locator('.fhi-thread').getByText('Can you quote the deck?')).toBeVisible()
    await replyField(page).fill('Glad to hear it.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect.poll(() => rpcCalls(context, 'fh_send_message').length).toBe(1)
    expect(rpcCalls(context, 'fh_send_message')[0].body).toEqual({
      p_body: 'Glad to hear it.', p_channel: 'email', p_client_id: 'cl-marcus', p_subject: 'Re: Final walkthrough'
    })
  })

  test('the draft says how it will go out', async ({ context, page }) => {
    await openThread(context, page)
    await expect(page.locator('.fhi-draft').getByText('Sends by text to Priya Rangarajan', { exact: true })).toBeVisible()
  })

  test('an email draft names its subject', async ({ context, page }) => {
    const mail = [
      message({ id: 'e2', conversation_id: 'conv-marcus', client_id: 'cl-marcus', channel: 'email', subject: 'Final walkthrough', created_at: '2026-10-09T21:30:00Z', body: 'Thanks, the crew did great work.' })
    ]
    const runs = [{
      id: 'run-mail', agent_id: 'agent-1', conversation_id: 'conv-marcus', client_id: 'cl-marcus', status: 'proposed',
      created_at: '2026-10-09T21:35:00Z', proposal: { channel: 'email', subject: 'Re: Final walkthrough', body: 'Thank you, Marcus. It was a pleasure.' }
    }]
    await openThread(context, page, { ...THREAD, fh_messages: mail, fh_agent_runs: runs }, 'conv-marcus')
    await expect(page.locator('.fhi-draft').getByText('Sends by email: Re: Final walkthrough', { exact: true })).toBeVisible()
  })

  test('a draft written before the customer last wrote is folded under Older draft', async ({ context, page }) => {
    // Written yesterday evening, before Priya asked to move the visit this morning.
    const runs = [{ ...RUNS[0], created_at: '2026-10-09T22:05:00Z' }]
    await openThread(context, page, { ...THREAD, fh_agent_runs: runs })
    const older = page.getByRole('button', { name: 'Older draft' })
    await expect(older).toBeVisible()
    await expect(older).toHaveAttribute('aria-expanded', 'false')
    await expect(sendDraft(page)).toHaveCount(0)
    await expect(draftBox(page)).toHaveCount(0)
    await older.click()
    await expect(older).toHaveAttribute('aria-expanded', 'true')
    await expect(draftBox(page)).toHaveValue(DRAFT_TEXT)
    await expect(sendDraft(page)).toBeVisible()
  })

  test('the draft Send waits until the drafts were read again after opening', async ({ context, page }, testInfo) => {
    await openThread(context, page)
    await expect(sendDraft(page)).toBeEnabled()
    // Leave the conversation and come back; the drafts in memory are not trusted until read again.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_agent_runs'), async (route) => {
      await gate
      await route.fallback()
    })
    if (testInfo.project.name.startsWith('mobile')) {
      await page.getByRole('link', { name: 'Back to inbox' }).click()
      await page.locator('.fhi-rows > li').filter({ hasText: 'Priya Rangarajan' }).getByRole('link').click()
    } else {
      const list = page.getByRole('complementary', { name: 'Conversations' })
      await list.locator('.fhi-rows > li').filter({ hasText: 'Marcus Bell' }).getByRole('link').click()
      await expect(page).toHaveURL(/\/inbox\/conv-marcus$/)
      await list.locator('.fhi-rows > li').filter({ hasText: 'Priya Rangarajan' }).getByRole('link').click()
    }
    await expect(page).toHaveURL(/\/inbox\/conv-priya$/)
    await expect(draftBox(page)).toHaveValue(DRAFT_TEXT)
    await expect(sendDraft(page)).toBeDisabled()
    release()
    await expect(sendDraft(page)).toBeEnabled()
  })

  test('the Inbox is never written to the offline cache', async ({ context, page }) => {
    // The real clock: the cache writer waits on Date.now, which a fixed clock stops.
    await signIn(context, { tables: THREAD })
    await page.goto('/inbox/conv-priya', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(draftBox(page)).toHaveValue(DRAFT_TEXT, { timeout: 30_000 })
    // The cache is written at most every two seconds.
    await page.waitForTimeout(3000)
    const saved = await page.evaluate(() => new Promise<string | null>((resolve) => {
      const open = indexedDB.open('keyval-store')
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        try {
          const read = open.result.transaction('keyval', 'readonly').objectStore('keyval').get('fh-query-cache')
          read.onsuccess = () => resolve(typeof read.result === 'string' ? read.result : null)
          read.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }
    }))
    expect(saved).not.toBeNull()
    const cache = JSON.parse(saved as string) as { clientState: { queries: Array<{ queryKey: unknown[] }>; mutations: Array<{ mutationKey?: unknown[] }> } }
    expect(cache.clientState.queries.length).toBeGreaterThan(0)
    expect(cache.clientState.queries.filter((q) => q.queryKey[0] === 'inbox')).toEqual([])
    expect(cache.clientState.mutations.filter((m) => m.mutationKey?.[0] === 'inbox')).toEqual([])
  })

  test('a failed send keeps the words, reads the thread again and says nothing was confirmed', async ({ context, page }) => {
    await openThread(context, page, { ...THREAD, fh_agent_runs: [] })
    await context.route('**/rest/v1/rpc/fh_send_message', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'upstream timeout' }) })
    )
    let reads = 0
    let counting = false
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_messages'), async (route) => {
      if (counting) reads += 1
      await route.fallback()
    })
    await replyField(page).fill('Thursday at 11:30 it is.')
    counting = true
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText("We couldn't confirm this went out.")).toBeVisible()
    await expect(page.getByText('Check the thread before sending again.')).toBeVisible()
    await expect(replyField(page)).toHaveValue('Thursday at 11:30 it is.')
    await expect.poll(() => reads).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'Send reply' })).toBeEnabled()
  })

  test('bubbles say who said them, and focus returns to the reply field', async ({ context, page }) => {
    await openThread(context, page)
    const thread = page.locator('.fhi-thread')
    await expect(thread.locator('.fhi-msg.is-out').first().getByText('You said', { exact: true })).toBeAttached()
    await expect(thread.locator('.fhi-msg.is-in').first().getByText('Priya Rangarajan said', { exact: true })).toBeAttached()

    await sendDraft(page).click()
    await expect.poll(() => rpcCalls(context, 'fh_agent_run_approve').length).toBe(1)
    await expect(draftBox(page)).toHaveCount(0)
    await expect(replyField(page)).toBeFocused()

    await replyField(page).fill('See you then.')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect.poll(() => rpcCalls(context, 'fh_send_message').length).toBe(1)
    await expect(replyField(page)).toHaveValue('')
    await expect(replyField(page)).toBeFocused()
  })

  test('focus returns to the reply field after a draft is discarded', async ({ context, page }) => {
    await openThread(context, page)
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect.poll(() => rpcCalls(context, 'fh_agent_run_reject').length).toBe(1)
    await expect(draftBox(page)).toHaveCount(0)
    await expect(replyField(page)).toBeFocused()
  })
})
