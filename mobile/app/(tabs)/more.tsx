// mobile/app/(tabs)/more.tsx — account + tools.
// Shows the signed-in account and a sign-out action. Sign-out clears the
// Supabase session; the root redirect gate then bounces back to /login.
import { View, Text, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { LogOut, Plug, ChevronRight, Building2 } from 'lucide-react-native'
import { useAuth } from '../../contexts/AuthContext'

export default function MoreScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, signOut } = useAuth()

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}
    >
      <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">More</Text>
      <Text className="text-ink text-3xl font-bold mb-6">Account</Text>

      <View className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] mb-6">
        <Text className="text-ink-muted text-[10px] font-bold tracking-wider uppercase mb-1">Signed in as</Text>
        <Text className="text-ink text-base font-bold" numberOfLines={1}>{user?.email || '—'}</Text>
      </View>

      <Text className="text-ink-muted text-[10px] font-bold tracking-wider uppercase mb-2">Tools</Text>
      <Pressable
        onPress={() => router.push('/settings')}
        className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] mb-3 flex-row items-center"
        style={{ gap: 12 }}
      >
        <View
          className="rounded-xl items-center justify-center"
          style={{ width: 40, height: 40, backgroundColor: '#1B1816', borderWidth: 1, borderColor: 'rgba(232,184,101,0.22)' }}
        >
          <Building2 color="#E8B865" size={18} />
        </View>
        <View className="flex-1">
          <Text className="text-ink text-base font-bold">Business profile</Text>
          <Text className="text-ink-muted text-xs mt-0.5">Company info for quotes & invoices</Text>
        </View>
        <ChevronRight color="#9b948a" size={18} />
      </Pressable>

      <Pressable
        onPress={() => router.push('/integrations')}
        className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] mb-6 flex-row items-center"
        style={{ gap: 12 }}
      >
        <View
          className="rounded-xl items-center justify-center"
          style={{ width: 40, height: 40, backgroundColor: '#1B1816', borderWidth: 1, borderColor: 'rgba(232,184,101,0.22)' }}
        >
          <Plug color="#E8B865" size={18} />
        </View>
        <View className="flex-1">
          <Text className="text-ink text-base font-bold">Integrations</Text>
          <Text className="text-ink-muted text-xs mt-0.5">QuickBooks, Stripe, Google, GHL, Jobber</Text>
        </View>
        <ChevronRight color="#9b948a" size={18} />
      </Pressable>

      <Pressable
        onPress={signOut}
        className="flex-row items-center justify-center rounded-2xl py-4 border border-[rgba(232,90,87,0.3)]"
        style={{ gap: 8, backgroundColor: 'rgba(232,90,87,0.10)' }}
      >
        <LogOut color="#f5a294" size={16} />
        <Text className="text-[#f5a294] text-base font-bold">Sign out</Text>
      </Pressable>

      <Text className="text-ink-muted text-xs text-center mt-8">FieldHorse · Built for the jobsite.</Text>
    </ScrollView>
  )
}
