import { useMemo } from 'react'
import { ResponsiveContainer, AreaChart, Area } from 'recharts'

type SparklineProps = {
  data?: Array<number | { v: number }> | null
  color?: string
  height?: number
  gradientId?: string
}

export default function Sparkline({ data, color = '#D4AF37', height = 56, gradientId = 'v3spark' }: SparklineProps) {
  const safe = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return [{ v: 0 }, { v: 0 }]
    return data.map((d) => (typeof d === 'number' ? { v: d } : d))
  }, [data])

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={safe} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.42} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2.2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={false}
            isAnimationActive
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
