import { describe, it, expect, afterAll } from 'vitest'

// A US timezone, where UTC parsing of a date only value lands on the
// previous calendar day.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const { composeActivityEvents, paymentWhen } = await import('./composeActivityEvents.ts')

describe('paymentWhen', () => {
  it('reads a backdated paid_on as that local calendar day', () => {
    const when = paymentWhen({ paid_on: '2026-06-01', created_at: '2026-06-05T15:00:00Z' })
    expect(when.getFullYear()).toBe(2026)
    expect(when.getMonth()).toBe(5)
    expect(when.getDate()).toBe(1)
  })

  it('uses the logged time when the payment was entered on its paid_on day', () => {
    // 10:30pm local on June 10 is already June 11 in UTC.
    const logged = new Date(2026, 5, 10, 22, 30)
    const when = paymentWhen({ paid_on: '2026-06-10', created_at: logged.toISOString() })
    expect(when.getTime()).toBe(logged.getTime())
  })

  it('falls back to created_at without a paid_on', () => {
    const when = paymentWhen({ paid_on: null, created_at: '2026-06-05T15:00:00Z' })
    expect(when.toISOString()).toBe('2026-06-05T15:00:00.000Z')
  })

  it('returns an invalid date when neither field is usable', () => {
    expect(Number.isNaN(paymentWhen({ paid_on: null, created_at: null }).getTime())).toBe(true)
  })
})

describe('composeActivityEvents payments', () => {
  it('places a payment on its paid_on day, not the evening before', () => {
    const events = composeActivityEvents({
      payments: [{ id: 'p1', amount: 1500, method: 'check', paid_on: '2026-06-01', created_at: '2026-06-03T14:00:00Z' }]
    })
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('payment')
    expect(events[0].when.getDate()).toBe(1)
    expect(events[0].when.getMonth()).toBe(5)
  })

  it('drops a payment with no usable date', () => {
    const events = composeActivityEvents({
      payments: [{ id: 'p1', amount: 10, paid_on: null, created_at: null }]
    })
    expect(events).toHaveLength(0)
  })
})

// formats-3: the job's activity names a payment to the cent, the same
// figure the invoice and the payment row show.
describe('composeActivityEvents money', () => {
  it('keeps the cents on payments and change orders', () => {
    const events = composeActivityEvents({
      payments: [{ id: 'p1', amount: 1000.5, method: 'check', paid_on: '2026-11-12', created_at: '2026-11-13T02:15:00Z' }],
      changeOrders: [{ id: 'co1', sequence_number: 1, title: 'Extra rebar', amount: 1235.5, status: 'pending', created_at: '2026-11-10T15:00:00Z' }]
    })
    expect(events.find((e) => e.kind === 'payment')!.title).toBe('$1,000.50 received')
    expect(events.find((e) => e.kind === 'change_order')!.sub).toBe('+$1,235.50')
  })

  it('prints a whole payment with .00', () => {
    const events = composeActivityEvents({
      payments: [{ id: 'p1', amount: 6400, method: 'check', paid_on: '2026-11-12', created_at: '2026-11-12T15:00:00Z' }]
    })
    expect(events[0].title).toBe('$6,400.00 received')
  })
})
