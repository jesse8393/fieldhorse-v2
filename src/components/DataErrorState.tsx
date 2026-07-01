import { AlertTriangle, RefreshCw } from 'lucide-react'

type DataErrorStateProps = {
  title?: string
  message?: string
  actionLabel?: string
  onRetry?: () => void
  compact?: boolean
  className?: string
}

export default function DataErrorState({
  title = 'Could not load this view',
  message = 'Check your connection and try again.',
  actionLabel = 'Retry',
  onRetry,
  compact = false,
  className = '',
}: DataErrorStateProps) {
  return (
    <div
      className={`fh-data-error${compact ? ' fh-data-error--compact' : ''}${className ? ` ${className}` : ''}`}
      role="alert"
    >
      <span className="fh-data-error__icon" aria-hidden="true">
        <AlertTriangle size={compact ? 15 : 18} />
      </span>
      <div className="fh-data-error__body">
        <strong>{title}</strong>
        {message && <span>{message}</span>}
      </div>
      {onRetry && (
        <button type="button" className="fh-data-error__retry" onClick={onRetry}>
          <RefreshCw size={13} aria-hidden="true" />
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  )
}
