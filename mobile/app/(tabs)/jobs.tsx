// mobile/app/(tabs)/jobs.tsx — the Jobs pipeline list.
// Same shared query hooks (useJobs / useJobsRealtime / useCreateLead),
// rebuilt on the premium v3 design primitives.
import { useMemo, useState } from 'react'
import {
  View, Text, FlatList, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Plus } from 'lucide-react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useJobs, useJobsRealtime, useCreateLead, type JobRow } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, Eyebrow, GoldButton, StagePill, STAGE_TINT, theme } from '../../components/ui'

const STAGE_FILTERS = ['all', 'lead', 'quote', 'job', 'invoice', 'closed', 'lost'] as const

function money(n: number | null | undefined) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export default function JobsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  useJobsRealtime(user?.id, queryClient)
  const createLead = useCreateLead()
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [leadName, setLeadName] = useState('')
  const [leadAmount, setLeadAmount] = useState('')
  const [saving, setSaving] = useState(false)

  async function submitLead() {
    if (!leadName.trim() || !user || saving) return
    setSaving(true)
    const amt = Number(leadAmount.replace(/[^0-9.]/g, '')) || undefined
    const { id, error } = await createLead({ userId: user.id, name: leadName.trim(), amount: amt })
    setSaving(false)
    if (!error) {
      setAddOpen(false)
      setLeadName('')
      setLeadAmount('')
      if (id) router.push(`/jobs/${id}`)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter((c) => {
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false
      if (!q) return true
      return [c.name, c.job_title, c.job_type, c.phone, c.email]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    })
  }, [jobs, search, stageFilter])

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10 }}>
      <ScreenBackground />
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Eyebrow>Jobs</Eyebrow>
        <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 }}>Pipeline</Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search jobs, contacts…"
          placeholderTextColor={theme.inkFaint}
          style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, fontSize: 15 }}
        />
      </View>

      <View style={{ paddingBottom: 14 }}>
        <FlatList
          data={STAGE_FILTERS as unknown as string[]}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => s}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          renderItem={({ item: s }) => {
            const active = stageFilter === s
            const chipTint = s === 'all' ? theme.goldBright : (STAGE_TINT[s] ?? '#5C5C5C')
            return (
              <Pressable
                onPress={() => setStageFilter(s)}
                style={{
                  borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1,
                  borderColor: active ? chipTint : theme.borderMid,
                  backgroundColor: active ? `${chipTint}26` : 'transparent'
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: active ? chipTint : theme.inkMuted }}>
                  {s}
                </Text>
              </Pressable>
            )
          }}
        />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.goldBright} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
          renderItem={({ item }) => <JobCard job={item} onPress={() => router.push(`/jobs/${item.id}`)} />}
          ListEmptyComponent={<Text style={{ color: theme.inkMuted, textAlign: 'center', marginTop: 48 }}>No jobs in this view.</Text>}
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={() => setAddOpen(true)}
        style={{
          position: 'absolute', right: 20, bottom: insets.bottom + 20, borderRadius: 999,
          shadowColor: '#E8B865', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12
        }}
      >
        <LinearGradient colors={['#F0CE86', '#E4BE6F', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
          <Plus color={theme.onGold} size={26} strokeWidth={2.8} />
        </LinearGradient>
      </Pressable>

      {/* New lead modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderTopWidth: 1, borderColor: theme.borderMid, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: 20 }}>New lead</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Name</Text>
            <TextInput
              value={leadName} onChangeText={setLeadName} autoFocus
              placeholder="Homeowner or company" placeholderTextColor={theme.inkFaint}
              style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, marginBottom: 16 }}
            />
            <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Estimated value (optional)</Text>
            <TextInput
              value={leadAmount} onChangeText={setLeadAmount} keyboardType="decimal-pad"
              placeholder="$0" placeholderTextColor={theme.inkFaint}
              style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, marginBottom: 20 }}
            />
            <GoldButton label="Create lead" onPress={submitLead} loading={saving} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function JobCard({ job, onPress }: { job: JobRow; onPress: () => void }) {
  const tint = STAGE_TINT[job.stage ?? ''] ?? '#3a352e'
  return (
    <Pressable onPress={onPress}>
      <Card accent={tint}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingLeft: 18 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{job.name || 'Untitled'}</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{job.job_title || job.job_type || '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.goldBright, fontSize: 17, fontWeight: '800' }}>{money(job.amount)}</Text>
            {job.stage ? <View style={{ marginTop: 5 }}><StagePill stage={job.stage} /></View> : null}
          </View>
        </View>
      </Card>
    </Pressable>
  )
}
