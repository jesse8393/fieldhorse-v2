import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MotionConfig } from 'framer-motion'
import CountUp from './CountUp.tsx'

// The Analytics tiles, the Pour Window figures and the Bid total count up
// with a spring that takes about four seconds to settle on its number.
// Under Reduce Motion (the MotionConfig in main.tsx follows the person's
// setting) spec 5.7 allows fades only, so the number shows at once: the
// cleanup guard's phone Analytics shot read $55K or $56K for Won YTD
// ($55,500) depending on when in that count it was taken.

const compact = (n: number) => `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`

function text(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '')
}

describe('CountUp', () => {
  it('shows the number at once under reduced motion, with no count from zero', () => {
    const html = renderToStaticMarkup(
      <MotionConfig reducedMotion="always">
        <CountUp to={55500} formatter={compact} />
      </MotionConfig>
    )
    expect(text(html)).toBe('$56K')
  })

  it('keeps the prefix and suffix and rounds to a whole number under reduced motion', () => {
    const html = renderToStaticMarkup(
      <MotionConfig reducedMotion="always">
        <CountUp to={1234.6} prefix="$" suffix=" total" />
      </MotionConfig>
    )
    expect(text(html)).toBe('$1,235 total')
  })

  it('draws the same markup either way, so nothing moves on the page', () => {
    const still = renderToStaticMarkup(
      <MotionConfig reducedMotion="always">
        <CountUp to={0} prefix="$" />
      </MotionConfig>
    )
    const moving = renderToStaticMarkup(
      <MotionConfig reducedMotion="never">
        <CountUp to={0} prefix="$" />
      </MotionConfig>
    )
    expect(still).toBe(moving)
  })

  it('still counts up from zero when motion is allowed', () => {
    const html = renderToStaticMarkup(
      <MotionConfig reducedMotion="never">
        <CountUp to={55500} formatter={compact} />
      </MotionConfig>
    )
    expect(text(html)).toBe('$0.0K')
  })
})
