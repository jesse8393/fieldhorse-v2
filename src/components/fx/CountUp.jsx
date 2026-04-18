import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect } from 'react'

export default function CountUp({ to = 0, duration = 1.2, prefix = '', suffix = '', formatter }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => {
    const n = Math.round(v)
    if (formatter) return formatter(n)
    return n.toLocaleString()
  })
  useEffect(() => {
    const controls = animate(count, to, { duration, ease: [0.32, 0.72, 0, 1] })
    return controls.stop
  }, [to, duration])
  return (
    <motion.span>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </motion.span>
  )
}
