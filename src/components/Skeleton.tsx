// Skeleton loader with gold shimmer sweep. Compose the primitives to match
// the shape of content that's loading. Respects prefers-reduced-motion.

export function SkeletonBlock({ w = '100%', h = 14, r = 2, className = '', style }: any) {
  return (
    <span
      className={`fh-skel ${className}`}
      style={{ width: w, height: typeof h === 'number' ? `${h}px` : h, borderRadius: r, ...style }}
      aria-hidden="true"
    />
  )
}

export function SkeletonText({ lines = 2, widths = ['80%', '60%'], gap = 8 }: any) {
  return (
    <span className="fh-skel-stack" style={{ gap }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonBlock key={i} w={widths[i] ?? widths[widths.length - 1]} h={12} />
      ))}
    </span>
  )
}

export function SkeletonCard({ avatar = true, amount = true }: any) {
  return (
    <div className="fh-skel-card" aria-hidden="true">
      {avatar && <SkeletonBlock w={40} h={40} r="50%" />}
      <div className="fh-skel-card__body">
        <div className="fh-skel-card__row">
          <SkeletonBlock w="48%" h={14} />
          {amount && <SkeletonBlock w="18%" h={14} />}
        </div>
        <div className="fh-skel-card__row" style={{ marginTop: 8 }}>
          <SkeletonBlock w="34%" h={10} />
          <SkeletonBlock w="22%" h={10} />
        </div>
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 4, card = true }: any) {
  return (
    <div className="fh-skel-list" aria-busy="true" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) =>
        card ? <SkeletonCard key={i} /> : <SkeletonBlock key={i} h={56} r={2} />
      )}
    </div>
  )
}

export function SkeletonStat() {
  return (
    <div className="fh-skel-stat" aria-hidden="true">
      <SkeletonBlock w="42%" h={9} />
      <SkeletonBlock w="70%" h={24} style={{ marginTop: 10 }} />
    </div>
  )
}
