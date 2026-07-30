// mobile/app/(tabs)/jobs.tsx — the Jobs pipeline list.
// Same shared query hooks (useJobs / useJobsRealtime / useCreateLead),
// rebuilt on the premium v3 design primitives.
import { useMemo, useState } from 'react'
import { View, Text, FlatList, Pressable, TextInput, ActivityIndicator, Image } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { Plus, User, ArrowUpRight, Star, Check } from 'lucide-react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useJobs, useJobsRealtime, useCoverPhotos, type JobRow } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, StagePill, STAGE_TINT, theme } from '../../components/ui'
import { NewLeadSheet } from '../../components/NewLeadSheet'

const STAGE_FILTERS = ['all', 'lead', 'quote', 'job', 'invoice', 'closed', 'lost'] as const
const STAGE_INDEX: Record<string, number> = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const NEXT_ACTION: Record<string, string> = {
  lead: 'Send a quote', quote: 'Get approval', job: 'Job in progress', invoice: 'Collect payment', closed: 'Closed out', lost: 'Marked lost'
}
const APPROVED = new Set(['job', 'invoice', 'closed'])

function money(n: number | null | undefined) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`
  return `$${Math.round(v).toLocaleString()}`
}
function initials(name: string | null | undefined) {
  return (name || '·').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '·'
}
function isCold(j: JobRow) {
  if (!(j.stage === 'lead' || j.stage === 'quote')) return false
  const d = j.updated_at ? new Date(j.updated_at).getTime() : Date.now()
  return Date.now() - d > 14 * 86400000
}

export default function JobsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const { data: covers = {} } = useCoverPhotos(user?.id)
  useJobsRealtime(user?.id, queryClient)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter((c) => {
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false
      if (!q) return true
      return [c.name, c.job_title, c.job_type, c.phone, c.email, c.fh_clients?.name]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    })
  }, [jobs, search, stageFilter])

  const summary = useMemo(() => {
    const active = new Set(['lead', 'quote', 'job', 'invoice'])
    let inMotion = 0, needEyes = 0
    const counts: Record<string, number> = { all: jobs.length }
    for (const j of jobs) {
      const s = j.stage ?? ''
      counts[s] = (counts[s] || 0) + 1
      if (active.has(s)) inMotion += Number(j.amount || 0)
      if (s === 'lead' || s === 'quote' || isCold(j)) needEyes += 1
    }
    return { inMotion, needEyes, counts }
  }, [jobs])

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10 }}>
      <ScreenBackground />
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
          <Text style={{ color: theme.ink }}>Jobs </Text>
          <Text style={{ color: theme.goldBright }}>&amp; Pipeline</Text>
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '700', marginTop: 6 }}>
          <Text style={{ color: theme.goldBright }}>{jobs.length}</Text>
          <Text style={{ color: theme.inkMuted }}> total · </Text>
          <Text style={{ color: theme.goldBright }}>{money(summary.inMotion)}</Text>
          <Text style={{ color: theme.inkMuted }}> in motion · </Text>
          <Text style={{ color: theme.danger }}>{summary.needEyes}</Text>
          <Text style={{ color: theme.inkMuted }}> need eyes</Text>
        </Text>
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
            const count = summary.counts[s] || 0
            return (
              <Pressable
                onPress={() => setStageFilter(s)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 7,
                  borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1,
                  borderColor: active ? chipTint : theme.borderMid,
                  backgroundColor: active ? `${chipTint}26` : 'transparent'
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: active ? chipTint : theme.inkMuted }}>
                  {s}
                </Text>
                <View style={{ minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: active ? `${chipTint}33` : 'rgba(255,240,210,0.08)', alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: active ? chipTint : theme.inkMuted }}>{count}</Text>
                </View>
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
          renderItem={({ item }) => <JobCard job={item} cover={covers[item.id]} onPress={() => router.push(`/jobs/${item.id}`)} />}
          ListEmptyComponent={<Text style={{ color: theme.inkMuted, textAlign: 'center', marginTop: 48 }}>No jobs in this view.</Text>}
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={() => setAddOpen(true)}
        style={{
          position: 'absolute', right: 20, bottom: insets.bottom + 20, borderRadius: 999,
          shadowColor: '#C9963A', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12
        }}
      >
        <LinearGradient colors={['#F0CE86', '#E4BE6F', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
          <Plus color={theme.onGold} size={26} strokeWidth={2.8} />
        </LinearGradient>
      </Pressable>

      {user ? (
        <NewLeadSheet open={addOpen} onClose={() => setAddOpen(false)} userId={user.id} onCreated={(id) => router.push(`/jobs/${id}`)} />
      ) : null}
    </View>
  )
}

function JobCard({ job, cover, onPress }: { job: JobRow; cover?: string; onPress: () => void }) {
  const stage = job.stage ?? ''
  const tint = STAGE_TINT[stage] ?? '#3a352e'
  const idx = STAGE_INDEX[stage] ?? 0
  const cold = isCold(job)
  const topDeal = Number(job.amount || 0) >= 50000
  const approved = APPROVED.has(stage)
  const contactName = job.fh_clients?.name || null

  return (
    <Pressable onPress={onPress}>
      <Card glow={topDeal} accent={tint}>
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: '100%', height: 150, backgroundColor: theme.surface2 }} />
        ) : null}
        <View style={{ padding: 16, paddingLeft: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {!cover ? (
              <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, marginRight: 12 }}>
                <Text style={{ color: theme.inkMuted, fontSize: 13, fontWeight: '800' }}>{initials(job.name)}</Text>
              </View>
            ) : null}
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: theme.ink, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{job.name || 'Untitled'}</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>{job.job_title || job.job_type || 'No job title'}</Text>
              {contactName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
                  <User color={theme.goldBright} size={11} />
                  <Text style={{ color: theme.goldBright, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }} numberOfLines={1}>{contactName}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ color: theme.goldBright, fontSize: 18, fontWeight: '800' }}>{money(job.amount)}</Text>
          </View>

          {/* Next action chip */}
          {stage && stage !== 'closed' && stage !== 'lost' ? (
            <View style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, marginTop: 12, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(232,184,101,0.28)', backgroundColor: 'rgba(232,184,101,0.08)' }}>
              <ArrowUpRight color={theme.goldBright} size={13} />
              <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '700' }}>Next: {NEXT_ACTION[stage]}</Text>
            </View>
          ) : null}

          {/* Badges + stage count */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 }}>
            {stage ? <StagePill stage={stage} /> : null}
            {approved ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(79,140,94,0.16)', borderWidth: 1, borderColor: 'rgba(79,140,94,0.4)' }}>
                <Check color="#5BB97A" size={10} />
                <Text style={{ color: '#5BB97A', fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>Approved</Text>
              </View>
            ) : null}
            {topDeal ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(232,184,101,0.14)', borderWidth: 1, borderColor: 'rgba(232,184,101,0.4)' }}>
                <Star color={theme.goldBright} size={10} />
                <Text style={{ color: theme.goldBright, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>Top deal</Text>
              </View>
            ) : null}
            {cold ? (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(232,90,87,0.14)', borderWidth: 1, borderColor: 'rgba(232,90,87,0.4)' }}>
                <Text style={{ color: theme.danger, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>Cold</Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            {idx > 0 ? <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700' }}>Stage {idx}/5</Text> : null}
          </View>

          {/* Progress bar */}
          {idx > 0 ? (
            <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,240,210,0.06)', overflow: 'hidden', marginTop: 8 }}>
              <View style={{ width: `${(idx / 5) * 100}%`, height: 5, borderRadius: 3, backgroundColor: tint }} />
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  )
}
