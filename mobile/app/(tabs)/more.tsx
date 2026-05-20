// mobile/app/(tabs)/more.tsx — placeholder pending full port.
// The web More screen ports here next, reusing the shared query
// hooks the same way jobs.tsx does.
import { View, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function MoreScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-1 bg-bg items-center justify-center" style={{ paddingTop: insets.top }}>
      <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase mb-2">More</Text>
      <Text className="text-ink text-2xl font-bold">More</Text>
      <Text className="text-ink-muted text-sm mt-2">Settings & tools</Text>
      <Text className="text-ink-muted text-xs mt-6 px-10 text-center">Ported next — reuses the shared TanStack Query hooks from lib/queries.ts.</Text>
    </View>
  )
}
