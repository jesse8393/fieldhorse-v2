import React from 'react'

/**
 * Top-level error boundary. Any render/runtime error below this point
 * surfaces as a visible fallback with the error text + a Reload button.
 * Without this, a thrown error anywhere in the tree would unmount the
 * entire app and the user sees a blank white/dark screen.
 */
export default class AppErrorBoundary extends React.Component<{ children?: React.ReactNode }, { error: any }> {
  constructor(props: any) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: any) {
    return { error }
  }

  componentDidCatch(error: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('[fieldhorse] app crash', error, info)
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
          minHeight: '100vh',
          padding: 24,
          display: 'grid',
          placeItems: 'center',
          background: '#141414',
          color: 'var(--v3-text)',
          fontFamily: 'DM Sans, system-ui, sans-serif'
        }}
      >
        <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 24, letterSpacing: 0, marginBottom: 12 }}>
            <span style={{ color: '#C9963A' }}>FIELD</span>HORSE
          </div>
          <h1 style={{ fontSize: 20, margin: '12px 0', color: '#C9963A' }}>Something broke loading this page.</h1>
          <pre
            style={{
              textAlign: 'left',
              padding: 12,
              borderRadius: 10,
              background: 'rgba(192,57,43,0.12)',
              border: '1px solid rgba(192,57,43,0.35)',
              color: '#C9963A',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere'
            }}
          >{msg}</pre>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: 16,
              padding: '12px 16px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #C9963A, #5C5C5C)',
              color: '#141414',
              fontFamily: 'Bebas Neue, sans-serif',
              fontSize: 14,
              letterSpacing: 0,
              cursor: 'pointer'
            }}
          >
            RELOAD
          </button>
        </div>
      </div>
    )
  }
}
