// mobile/app/subs.tsx, subcontractor directory rolled up from fh_subs
// by name/phone, with job history, search + trade filter, and add-sub.
import { useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Hammer, Search, Plus, Phone, ChevronRight, IdCard } from 'lucide-react-native'
import { useSubsRoster, useAddSubGlobal, type SubsRoster } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../../components/ui'

type Group = {
  key: string; name: string; phone: string; trades: string[]
  jobsCount: number; totalRate: number; lastWorked: number | null
  rows: { id: string; rate: number; status: string; contactId: string | null }[]
}

function money(n: number) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `$${Math.round(n).toLocaleString()}`
}
function relDate(ms: number | null) {
  if (!ms) return ''
  const d = Math.floor((Date.now() - ms) / 86400000)
  if (d < 1) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

export default function SubsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading } = useSubsRoster(user?.id)
  const [q, setQ] = useState('')
  const [trade, setTrade] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const grouped = useMemo<Group[]>(() => {
    const rows = data?.subs ?? []
    const map = new Map<string, Group>()
    for (const r of rows) {
      const key = (r.phone || r.name || '').toLowerCase().trim() || '__untitled__'
      let g = map.get(key)
      if (!g) { g = { key, name: r.name?.trim() || '(Unnamed sub)', phone: r.phone || '', trades: [], jobsCount: 0, totalRate: 0, lastWorked: null, rows: [] }; map.set(key, g) }
      if (r.trade && !g.trades.includes(r.trade)) g.trades.push(r.trade)
      g.totalRate += Number(r.rate || 0)
      if (r.contactId && !g.rows.some((x) => x.contactId === r.contactId)) g.jobsCount++
      const c = r.createdAt ? new Date(r.createdAt).getTime() : null
      if (c && (!g.lastWorked || c > g.lastWorked)) g.lastWorked = c
      g.rows.push({ id: r.id, rate: Number(r.rate || 0), status: r.status || 'scheduled', contactId: r.contactId })
    }
    return Array.from(map.values()).sort((a, b) => (a.lastWorked && b.lastWorked ? b.lastWorked - a.lastWorked : a.name.localeCompare(b.name)))
  }, [data?.subs])

  const allTrades = useMemo(() => Array.from(new Set(grouped.flatMap((g) => g.trades))).sort(), [grouped])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return grouped.filter((g) => {
      if (trade && !g.trades.includes(trade)) return false
      if (!needle) return true
      return g.name.toLowerCase().includes(needle) || g.phone.toLowerCase().includes(needle) || g.trades.some((t) => t.toLowerCase().includes(needle))
    })
  }, [grouped, q, trade])

  const totalBilled = useMemo(() => grouped.reduce((s, g) => s + g.totalRate, 0), [grouped])
  const topKey = useMemo(() => {
    if (filtered.length < 2) return null
    let key: string | null = null, max = 0
    for (const g of filtered) if (g.totalRate > max) { max = g.totalRate; key = g.key }
    return max > 0 ? key : null
  }, [filtered])

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Sub Directory" title="Subs"
          right={<Pressable onPress={() => setAddOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.goldBright }}><Plus color={theme.onGold} size={14} strokeWidth={2.6} /><Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 12, letterSpacing: 0 }}>ADD</Text></Pressable>} />

        <Card glow style={{ marginTop: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', padding: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.goldBright, fontSize: 24, fontWeight: '800' }}>{money(totalBilled)}</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>Total billed · {grouped.length} sub{grouped.length === 1 ? '' : 's'}</Text>
            </View>
            <View style={{ width: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.ink, fontSize: 24, fontWeight: '800' }}>{allTrades.length}</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>Trades covered</Text>
            </View>
          </View>
        </Card>

        {/* search */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: theme.surface, marginBottom: 12 }}>
          <Search color={theme.inkMuted} size={15} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search name, phone, trade…" placeholderTextColor={theme.inkMuted} style={{ flex: 1, color: theme.ink, fontSize: 14, paddingVertical: 12 }} />
        </View>

        {allTrades.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <TradePill label="All" active={!trade} onPress={() => setTrade('')} />
            {allTrades.map((t) => <TradePill key={t} label={t} active={trade === t} onPress={() => setTrade(t)} />)}
          </View>
        ) : null}

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 16 }} />
        ) : grouped.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 8 }}>No subs yet. Add one, or assign subs from a job's Subs section, they show up here automatically.</Text>
        ) : filtered.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 8 }}>No subs match that filter.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {filtered.map((g) => <SubCard key={g.key} g={g} contacts={data?.contacts ?? {}} isTop={g.key === topKey} onJob={(id) => router.push(`/jobs/${id}`)} onProfile={() => router.push(`/subs/${encodeURIComponent(g.key)}`)} />)}
          </View>
        )}
      </ScrollView>

      <AddSubModal open={addOpen} onClose={() => setAddOpen(false)} />
    </View>
  )
}

function TradePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: active ? theme.goldBright : theme.borderMid, backgroundColor: active ? `${theme.goldBright}26` : 'transparent' }}>
      <Text style={{ color: active ? theme.goldBright : theme.inkMuted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{label}</Text>
    </Pressable>
  )
}

function SubCard({ g, contacts, isTop, onJob, onProfile }: { g: Group; contacts: SubsRoster['contacts']; isTop: boolean; onJob: (id: string) => void; onProfile: () => void }) {
  const [open, setOpen] = useState(false)
  const initials = g.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'SB'
  return (
    <Card accent={isTop ? theme.goldBright : undefined}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16 }}>
        <View style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.borderGold }}>
          <Text style={{ color: theme.goldBright, fontWeight: '800', fontSize: 14 }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{g.name}</Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: theme.borderGold, backgroundColor: `${theme.goldBright}1a` }}>
              <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>{g.jobsCount} JOB{g.jobsCount === 1 ? '' : 'S'}</Text>
            </View>
            {isTop ? <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>TOP</Text> : null}
          </View>
          <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{g.trades.join(' · ') || 'No trade set'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
            {g.totalRate > 0 ? <Text style={{ color: theme.inkMuted, fontSize: 12 }}><Text style={{ color: theme.ink, fontWeight: '700' }}>${g.totalRate.toLocaleString()}</Text> billed</Text> : null}
            {g.lastWorked ? <Text style={{ color: theme.inkMuted, fontSize: 12 }}>Last: {relDate(g.lastWorked)}</Text> : null}
          </View>
        </View>
        <ChevronRight color={theme.inkMuted} size={16} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
      </Pressable>

      {open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 16 }}>
          <Pressable onPress={onProfile} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
            <IdCard color={theme.goldBright} size={15} />
            <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700', flex: 1 }}>View vendor profile</Text>
            <ChevronRight color={theme.goldBright} size={14} />
          </Pressable>
          {g.phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${g.phone}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
              <Phone color={theme.goldBright} size={14} />
              <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600' }}>{g.phone}</Text>
            </Pressable>
          ) : null}
          {g.rows.filter((r) => r.contactId).map((r) => {
            const c = r.contactId ? contacts[r.contactId] : null
            return (
              <Pressable key={r.id} onPress={() => r.contactId && onJob(r.contactId)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{c?.name || '(Job not found)'}</Text>
                  {c?.jobTitle ? <Text style={{ color: theme.inkMuted, fontSize: 12 }} numberOfLines={1}>{c.jobTitle}</Text> : null}
                </View>
                <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{r.rate > 0 ? `$${r.rate.toLocaleString()}` : '\u2003'}</Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2 }}>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase' }}>{r.status}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </Card>
  )
}

function AddSubModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const addSub = useAddSubGlobal()
  const [name, setName] = useState('')
  const [trade, setTrade] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim() || !user) return
    setSaving(true)
    const { error } = await addSub({ userId: user.id, name: name.trim(), trade: trade.trim() || null, phone: phone.trim() || null })
    setSaving(false)
    if (error) { Alert.alert("Couldn't add sub", error.message); return }
    setName(''); setTrade(''); setPhone(''); onClose()
  }

  const field = { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, color: theme.ink, fontSize: 14 } as const
  const label = { color: theme.inkMuted, fontSize: 12, fontWeight: '800' as const, letterSpacing: 0, textTransform: 'uppercase' as const, marginBottom: 6 }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(20, 20, 20,0.6)', justifyContent: 'flex-end' }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 20 }}>
          <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>New sub</Text>
          <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '700', marginTop: 4, marginBottom: 18 }}>Add to directory</Text>
          <Text style={label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Crew lead or company" placeholderTextColor={theme.inkMuted} style={[field, { marginBottom: 14 }]} autoFocus />
          <Text style={label}>Trade</Text>
          <TextInput value={trade} onChangeText={setTrade} placeholder="Framer, electrician, roofer…" placeholderTextColor={theme.inkMuted} style={[field, { marginBottom: 14 }]} />
          <Text style={label}>Phone</Text>
          <TextInput value={phone} onChangeText={setPhone} placeholder="(615) 555-0000" placeholderTextColor={theme.inkMuted} keyboardType="phone-pad" style={[field, { marginBottom: 20 }]} />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={onClose} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid }}>
              <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={!name.trim() || saving} style={{ flex: 1.5, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: theme.goldBright, opacity: !name.trim() || saving ? 0.5 : 1 }}>
              <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14 }}>{saving ? 'Saving…' : 'Add sub'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
