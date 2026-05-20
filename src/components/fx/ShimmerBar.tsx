export default function ShimmerBar({ value = 0, className = '' }: { value?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={`fh-fx-shimmer-bar ${className}`}>
      <div className="fh-fx-shimmer-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
