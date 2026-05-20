// mobile/app/partners.tsx — roster of partners you've shared jobs with.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Mail, Briefcase } from 'lucide-react-native'
import { usePartners, type PartnerEntry } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

function initials(name: string | null, email: string) {
  const s = (name || email).trim()
  const parts = s.split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || s[0]?.toUpperCase() || '?'
}

export default function PartnersScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading } = usePartners(user?.id)

  const partners = data ?? []
  const totalJobs = partners.reduce((s, p) => s + p.jobs.length, 0)
  const pendingTotal = partners.reduce((s, p) => s + p.pending, 0)

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Partners" title="Your network" />

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : partners.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 24 }}>No partners yet. When you share a job with a collaborator, they'll appear here.</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16, marginBottom: 18 }}>
              <MiniStat label="Partners" value={String(partners.length)} />
              <MiniStat label="Jobs shared" value={String(totalJobs)} />
              <MiniStat label="Pending" value={String(pendingTotal)} tint={pendingTotal ? '#C9963A' : theme.ink} />
            </View>

            <View style={{ gap: 12 }}>
              {partners.map((p) => (
                <PartnerCard key={p.email} p={p} onJob={(id) => router.push(`/jobs/${id}`)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function MiniStat({ label, value, tint = theme.ink }: { label: string; value: string; tint?: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <View style={{ padding: 14 }}>
        <Text style={{ color: tint, fontSize: 24, fontWeight: '800' }}>{value}</Text>
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 2 }}>{label}</Text>
      </View>
    </Card>
  )
}

function PartnerCard({ p, onJob }: { p: PartnerEntry; onJob: (id: string) => void }) {
  const active = p.accepted > 0
  return (
    <Card accent={active ? theme.success : '#C9963A'}>
      <View style={{ padding: 16, paddingLeft: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.goldBright}1f`, borderWidth: 1, borderColor: theme.borderGold }}>
            <Text style={{ color: theme.goldBright, fontWeight: '800', fontSize: 16 }}>{initials(p.name, p.email)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.ink, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{p.name || p.email}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {p.role ? <Briefcase color={theme.inkMuted} size={11} /> : null}
              <Text style={{ color: theme.inkMuted, fontSize: 12.5 }} numberOfLines={1}>{p.role ? `${p.role} · ` : ''}{p.jobs.length} job{p.jobs.length === 1 ? '' : 's'} shared</Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: active ? `${theme.success}55` : '#C9963A55', backgroundColor: active ? `${theme.success}1f` : '#C9963A1f' }}>
            <Text style={{ color: active ? theme.success : '#E8B865', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>{active ? 'ACTIVE' : 'PENDING'}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13 }}>
          {p.jobs.slice(0, 6).map((j, i) => (
            <Pressable key={j.id + i} onPress={() => onJob(j.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: 'rgba(255,240,210,0.04)' }}>
              <Text style={{ color: theme.ink, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{j.name || 'Job'}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => Linking.openURL(`mailto:${p.email}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: theme.borderMid, marginTop: 14 }}>
          <Mail color={theme.ink} size={14} />
          <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 13 }}>{p.email}</Text>
        </Pressable>
      </View>
    </Card>
  )
}
