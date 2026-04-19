import { motion, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'

// Spring-driven count-up. Stiffness 120 / damping 20 gives a subtle bouncy
// arrival — the number overshoots the target by a hair then settles. Tuned
// to feel "premium" without overshooting wildly enough to ship wrong values
// mid-animation. The `duration` prop (legacy from the tween-based version)
// is accepted and ignored — spring physics use stiffness/damping instead.
export default function CountUp({ to = 0, duration, prefix = '', suffix = '', formatter }) {
  const count = useSpring(0, { stiffness: 120, damping: 20 })
  const rounded = useTransform(count, (v) => {
    const n = Math.round(v)
    if (formatter) return formatter(n)
    return n.toLocaleString()
  })
  useEffect(() => {
    count.set(to)
  }, [to, count])
  return (
    <motion.span>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </motion.span>
  )
}
