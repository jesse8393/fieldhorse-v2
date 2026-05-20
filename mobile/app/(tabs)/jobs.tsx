// mobile/app/(tabs)/jobs.tsx — the Jobs list, ported from the web
// Jobs screen. Demonstrates the shared-logic thesis: this screen uses
// the SAME query hook shape (useJobs / useJobsRealtime) as the web app,
// just rendered with React Native primitives + NativeWind classes
// instead of divs + inline styles.
import { useMemo, useState } from 'react'
import {
  View, Text, FlatList, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Plus } from 'lucide-react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useJobs, useJobsRealtime, useCreateLead, type JobRow } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'

const STAGE_TINT: Record<string, string> = {
  lead: '#6B7CA8',
  quote: '#B07A4A',
  job: '#4F8C5E',
  invoice: '#C9963A',
  closed: '#5C5C5C',
  lost: '#7d2a1f'
}

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
  // userId would come from an auth context (Supabase session) in the
  // full build; realtime is wired the moment it's available.
  const { user } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  useJobsRealtime(user?.id, queryClient)
  const createLead = useCreateLead()
  const [search, setSearch] = useState('')
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
    if (!q) return jobs
    return jobs.filter((c) =>
      [c.name, c.job_title, c.job_type, c.phone, c.email]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    )
  }, [jobs, search])

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-3">
        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Jobs</Text>
        <Text className="text-ink text-3xl font-bold">Pipeline</Text>
      </View>

      <View className="px-5 pb-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search jobs, contacts…"
          placeholderTextColor="rgba(242,237,228,0.45)"
          className="bg-surface border border-[rgba(255,240,210,0.10)] rounded-xl px-4 py-3 text-ink"
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#E8B865" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 8 }}
          renderItem={({ item }) => <JobCard job={item} onPress={() => router.push(`/jobs/${item.id}`)} />}
          ListEmptyComponent={
            <Text className="text-ink-muted text-center mt-12">No jobs in this view.</Text>
          }
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={() => setAddOpen(true)}
        className="absolute items-center justify-center rounded-full"
        style={{
          right: 20, bottom: insets.bottom + 20, width: 56, height: 56,
          backgroundColor: '#E8B865', shadowColor: '#000', shadowOpacity: 0.4,
          shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8
        }}
      >
        <Plus color="#1A120A" size={26} strokeWidth={2.6} />
      </Pressable>

      {/* New lead modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setAddOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">New lead</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Name</Text>
            <TextInput
              value={leadName}
              onChangeText={setLeadName}
              placeholder="Homeowner or company"
              placeholderTextColor="rgba(242,237,228,0.4)"
              autoFocus
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Estimated value (optional)</Text>
            <TextInput
              value={leadAmount}
              onChangeText={setLeadAmount}
              keyboardType="decimal-pad"
              placeholder="$0"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
            />
            <Pressable
              onPress={submitLead}
              disabled={saving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: saving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {saving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Create lead</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function JobCard({ job, onPress }: { job: JobRow; onPress: () => void }) {
  const tint = STAGE_TINT[job.stage ?? ''] ?? '#5C5C5C'
  return (
    <Pressable
      onPress={onPress}
      className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] flex-row items-center"
      style={{ gap: 12 }}
    >
      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, backgroundColor: tint }} />
      <View className="flex-1">
        <Text className="text-ink text-base font-bold" numberOfLines={1}>
          {job.name || 'Untitled'}
        </Text>
        <Text className="text-ink-muted text-xs mt-1" numberOfLines={1}>
          {job.job_title || job.job_type || '—'}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-gold-bright text-base font-bold">{money(job.amount)}</Text>
        <Text className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: tint }}>
          {job.stage}
        </Text>
      </View>
    </Pressable>
  )
}
