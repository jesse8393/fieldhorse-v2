import { motion, useReducedMotionConfig, useSpring, useTransform } from 'framer-motion'
import { useEffect } from 'react'

// Spring-driven count-up. Critically damped, damping > 2*sqrt(stiffness)
// ensures the spring monotonically approaches `to` without overshooting
// or oscillating. The previous tuning (stiffness 120, damping 20) was
// underdamped: the number would overshoot the target before settling,
// so users who happened to glance at the hero card during animation saw
// values like $43k when the real total was $160k.
//
// Under Reduce Motion the number shows at once (spec 5.7: fades only).
// MotionConfig in main.tsx follows the person's setting, but a useSpring
// value ignores it, so without this the count still ran for about four
// seconds from zero.
type CountUpProps = {
  to?: number
  duration?: number
  prefix?: string
  suffix?: string
  formatter?: (n: number) => string
}

export default function CountUp({ to = 0, duration, prefix = '', suffix = '', formatter }: CountUpProps) {
  const still = useReducedMotionConfig()
  const format = (v: number) => {
    const n = Math.round(v)
    if (formatter) return formatter(n)
    return n.toLocaleString()
  }
  const count = useSpring(still ? to : 0, { stiffness: 90, damping: 30, mass: 1 })
  const rounded = useTransform(count, format)
  useEffect(() => {
    if (still) count.jump(to)
    else count.set(to)
  }, [to, count, still])
  return (
    <motion.span>
      {prefix}
      <motion.span>{still ? format(to) : rounded}</motion.span>
      {suffix}
    </motion.span>
  )
}
