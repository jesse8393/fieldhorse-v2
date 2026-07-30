// mobile/components/SearchOverlay.tsx, universal search palette.
// Mirrors web's MobileSearchOverlay: one query across jobs and clients,
// results navigate straight to the detail screen. Opened by the Search
// button in the Home header.
import { useMemo, useState } from 'react'
import { View, Text, Modal, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Search, Briefcase, User } from 'lucide-react-native'
import { useJobs, useClientsBundle } from '../lib/queries'
import { theme } from './ui'

function money(n: number | null | undefined) {
  const v = Number(n || 0)
  if (!v) return ''
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export function SearchOverlay({ open, onClose, userId }: { open: boolean; onClose: () => void; userId?: string }) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { data: jobs = [], isLoading: jobsLoading } = useJobs()
  const { data: bundle } = useClientsBundle(userId)
  const clients = bundle?.clients ?? []
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()

  const jobHits = useMemo(() => {
    if (!query) return []
    return jobs.filter((j) =>
      [j.name, j.job_title, j.job_type, j.phone, j.email, j.fh_clients?.name]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(query))
    ).slice(0, 12)
  }, [jobs, query])

  const clientHits = useMemo(() => {
    if (!query) return []
    return clients.filter((c) =>
      [c.name, c.company_name, c.phone, c.email]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(query))
    ).slice(0, 12)
  }, [clients, query])

  function go(path: string) {
    onClose()
    setQ('')
    router.push(path as any)
  }

  const empty = query.length > 0 && jobHits.length === 0 && clientHits.length === 0

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + 8 }}>
        {/* Search bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 }}>
            <Search color={theme.goldBright} size={18} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search jobs & clients…"
              placeholderTextColor={theme.inkFaint}
              autoFocus
              style={{ flex: 1, color: theme.ink, fontSize: 16 }}
            />
          </View>
          <Pressable onPress={() => { setQ(''); onClose() }} hitSlop={8}>
            <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          {query.length === 0 ? (
            <Text style={{ color: theme.inkMuted, fontSize: 14, textAlign: 'center', marginTop: 48 }}>Search across every job and client.</Text>
          ) : empty ? (
            <Text style={{ color: theme.inkMuted, fontSize: 14, textAlign: 'center', marginTop: 48 }}>No matches for “{q.trim()}”.</Text>
          ) : (
            <>
              {jobHits.length > 0 ? (
                <>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 }}>Jobs</Text>
                  {jobHits.map((j) => (
                    <Pressable key={j.id} onPress={() => go(`/jobs/${j.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}>
                        <Briefcase color={theme.goldBright} size={15} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{j.name || 'Untitled'}</Text>
                        <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{j.job_title || j.job_type || j.stage || '\u2003'}</Text>
                      </View>
                      {j.amount ? <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '800' }}>{money(j.amount)}</Text> : null}
                    </Pressable>
                  ))}
                </>
              ) : null}

              {clientHits.length > 0 ? (
                <>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>Clients</Text>
                  {clientHits.map((c) => (
                    <Pressable key={c.id} onPress={() => go(`/clients/${c.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}>
                        <User color={theme.goldBright} size={15} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{c.name || 'Unnamed'}</Text>
                        <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{c.company_name || c.email || c.phone || '\u2003'}</Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : null}

              {jobsLoading ? <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} /> : null}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}
