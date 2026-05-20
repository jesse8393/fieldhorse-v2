// mobile/app/_layout.tsx — root layout.
// Mounts QueryClientProvider (same client config as web), the auth
// provider, the gesture handler root, and a dark Stack. A redirect gate
// sends signed-out users to /login and signed-in users into the (tabs)
// group. Native gives us real safe-area handling for free via
// SafeAreaProvider — no more env(safe-area-inset) CSS hacks.
import '../global.css'
import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { queryClient } from '../lib/queryClient'
import { AuthProvider, useAuth } from '../contexts/AuthContext'

// Redirect gate: keeps the user on /login until there's a session, and
// out of /login once signed in. Runs whenever session or route changes.
function useAuthGate() {
  const { session, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const onLogin = segments[0] === 'login'
    if (!session && !onLogin) router.replace('/login')
    else if (session && onLogin) router.replace('/')
  }, [session, loading, segments])
}

function RootNavigator() {
  const { loading } = useAuth()
  useAuthGate()

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0907', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#E8B865" />
      </View>
    )
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0B0907' }
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="jobs/[id]" />
      <Stack.Screen name="clients/[id]" />
      <Stack.Screen name="integrations" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="quote/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="analytics" />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0B0907' }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
