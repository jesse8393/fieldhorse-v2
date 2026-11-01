import { Component, type ReactNode } from 'react'
import { Text, View, Pressable } from 'react-native'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { GoldButton, theme } from './ui'
import { useAuth } from '../contexts/AuthContext'

class RetryBoundary extends Component<{ children: ReactNode; reset: () => void; signOut: () => Promise<void> }, { failed: boolean; signingOut: boolean }> {
  state = { failed: false, signingOut: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 24, gap: 20 }}>
        <Text accessibilityRole="header" style={{ color: theme.ink, fontSize: 24, fontWeight: '700' }}>Couldn't load this screen</Text>
        <Text style={{ color: theme.ink, fontSize: 16 }}>Check your connection and try again.</Text>
        <GoldButton label="Try again" onPress={() => { this.props.reset(); this.setState({ failed: false }) }} />
        <Pressable accessibilityRole="button" disabled={this.state.signingOut} onPress={async () => {
          this.setState({ signingOut: true })
          try { await this.props.signOut() } catch { /* stay on the retry screen */ }
          finally { this.setState({ signingOut: false }) }
        }} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.ink }}>{this.state.signingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      </View>
    )
  }
}

export function DataLoadBoundary({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  return <QueryErrorResetBoundary>{({ reset }) => (
    <RetryBoundary key={user?.id ?? 'signed-out'} reset={reset} signOut={signOut}>{children}</RetryBoundary>
  )}</QueryErrorResetBoundary>
}
