// mobile/app/_layout.tsx — root layout.
// Mounts QueryClientProvider (same client config as web), the gesture
// handler root, and a dark Stack. Native gives us real safe-area
// handling for free via SafeAreaProvider — no more env(safe-area-inset)
// CSS hacks that the PWA needed.
import '../global.css'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { queryClient } from '../lib/queryClient'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0B0907' }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0B0907' }
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
