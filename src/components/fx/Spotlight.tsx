export default function Spotlight({ className = '', style = {} }: { className?: string; style?: import('react').CSSProperties }) {
  return <div className={`fh-fx-spotlight ${className}`} style={style} aria-hidden="true" />
}
