import React from 'react'

/**
 * Screen-level error boundary. Wraps the routed <Outlet /> inside
 * AppShell so a crash in any single screen shows a v3-themed
 * fallback instead of unmounting the whole app (header + nav stay).
 *
 * Reset on navigation: parent passes the current location.key as
 * resetKey; when it changes, the boundary clears its error state so
 * the new route can render normally.
 */
export default class RouteErrorBoundary extends React.Component<{ children?: React.ReactNode; resetKey?: any }, { error: any }> {
  constructor(props: any) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: any) {
    return { error }
  }

  componentDidUpdate(prevProps: any) {
    // Reset when the user navigates to a new route, otherwise a
    // crashed screen would leave the boundary stuck even after the
    // user clicks away to a healthy route.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('[fieldhorse] route crash', error, info)
  }

  handleHome = () => {
    this.setState({ error: null })
    if (typeof window !== 'undefined') {
      window.location.assign('/')
    }
  }

  handleReload = () => {
    this.setState({ error: null })
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const msg = this.state.error?.message || String(this.state.error)

    return (
      <div
        role="alert"
        style={{
          minHeight: 'calc(100dvh - 200px)',
          display: 'grid',
          placeItems: 'center',
          padding: '32px var(--v3-gutter)'
        }}
      >
        <div
          className="v3-section"
          style={{
            maxWidth: 480,
            width: '100%',
            textAlign: 'center'
          }}
        >
          <div className="v3-eyebrow" style={{ color: 'var(--v3-danger-bright)' }}>
            Screen Error
          </div>
          <h2 className="v3-h1" style={{ marginTop: 8 }}>
            Something went wrong <em>loading this screen.</em>
          </h2>
          <p
            className="v3-caption"
            style={{ marginTop: 8, lineHeight: 1.5 }}
          >
            The rest of the app is still working. Try reloading or jump back home.
          </p>

          <details
            style={{
              marginTop: 14,
              textAlign: 'left',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              color: 'var(--v3-text-muted)'
            }}
          >
            <summary style={{ cursor: 'pointer', marginBottom: 6 }}>
              Error details
            </summary>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 10,
                background: 'var(--v3-danger-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
                color: 'var(--v3-danger-bright)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere'
              }}
            >
              {msg}
            </pre>
          </details>

          <div style={{ marginTop: 18, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.handleHome}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderRadius: 10,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
                background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                color: 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 0,
                cursor: 'pointer',
                boxShadow: '0 0 0 3px rgba(201, 150, 58, 0.16), 0 4px 12px rgba(201, 150, 58, 0.30), 0 1px 0 var(--v3-border-strong) inset'
              }}
            >
              Go Home
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderRadius: 10,
                border: '1px solid var(--v3-border-strong)',
                background: 'var(--v3-surface-2)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
