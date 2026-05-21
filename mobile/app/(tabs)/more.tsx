// mobile/app/(tabs)/more.tsx — account + tools, on the premium primitives.
import { View, Text, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { LogOut, Plug, ChevronRight, Building2, BarChart3, Bell, Receipt, Activity, Users, FileSignature, StickyNote, Hammer, CloudSun } from 'lucide-react-native'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, Eyebrow, SectionLabel, theme } from '../../components/ui'

export default function MoreScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, signOut } = useAuth()

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Eyebrow>More</Eyebrow>
        <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', letterSpacing: -0.5, marginBottom: 20 }}>Account</Text>

        <Card style={{ marginBottom: 24 }}>
          <View style={{ padding: 16 }}>
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Signed in as</Text>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{user?.email || '—'}</Text>
          </View>
        </Card>

        <SectionLabel style={{ marginBottom: 10 }}>Tools</SectionLabel>
        <View style={{ gap: 10, marginBottom: 24 }}>
          <MenuRow icon={<Receipt color={theme.goldBright} size={18} />} title="Invoices & Payments" sub="Money owed, aging & mark paid" onPress={() => router.push('/invoices')} />
          <MenuRow icon={<StickyNote color={theme.goldBright} size={18} />} title="Notes" sub="Capture, link to jobs & review" onPress={() => router.push('/notes')} />
          <MenuRow icon={<Activity color={theme.goldBright} size={18} />} title="Activity" sub="Payments, leads, invoices & notes" onPress={() => router.push('/activity')} />
          <MenuRow icon={<FileSignature color={theme.goldBright} size={18} />} title="Estimates" sub="Proposals, win rate & open value" onPress={() => router.push('/estimates')} />
          <MenuRow icon={<Users color={theme.goldBright} size={18} />} title="Partners" sub="People you've shared jobs with" onPress={() => router.push('/partners')} />
          <MenuRow icon={<Hammer color={theme.goldBright} size={18} />} title="Subs" sub="Trade directory, rates & job history" onPress={() => router.push('/subs')} />
          <MenuRow icon={<CloudSun color={theme.goldBright} size={18} />} title="Pour Window" sub="Weather work-window by trade" onPress={() => router.push('/pour-window')} />
          <MenuRow icon={<BarChart3 color={theme.goldBright} size={18} />} title="Analytics" sub="Pipeline, revenue & stage breakdown" onPress={() => router.push('/analytics')} />
          <MenuRow icon={<Bell color={theme.goldBright} size={18} />} title="Notifications" sub="Activity & alerts" onPress={() => router.push('/notifications')} />
          <MenuRow icon={<Building2 color={theme.goldBright} size={18} />} title="Business profile" sub="Company info for quotes & invoices" onPress={() => router.push('/settings')} />
          <MenuRow icon={<Plug color={theme.goldBright} size={18} />} title="Integrations" sub="QuickBooks, Stripe, Google, GHL, Jobber" onPress={() => router.push('/integrations')} />
        </View>

        <Pressable
          onPress={signOut}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(232,90,87,0.3)', backgroundColor: 'rgba(232,90,87,0.10)' }}
        >
          <LogOut color={theme.danger} size={16} />
          <Text style={{ color: theme.danger, fontSize: 16, fontWeight: '700' }}>Sign out</Text>
        </Pressable>

        <Text style={{ color: theme.inkMuted, fontSize: 12, textAlign: 'center', marginTop: 28 }}>FieldHorse · Built for the jobsite.</Text>
      </ScrollView>
    </View>
  )
}

function MenuRow({ icon, title, sub, onPress }: { icon: React.ReactNode; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: 'rgba(232,184,101,0.22)' }}>
            {icon}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }}>{title}</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>{sub}</Text>
          </View>
          <ChevronRight color="#9b948a" size={18} />
        </View>
      </Card>
    </Pressable>
  )
}
