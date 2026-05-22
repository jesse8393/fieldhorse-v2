// mobile/app/quote/[id].tsx — quote / estimate line-item builder.
// id is the job (contact) id. Lists fh_quote_items grouped by section,
// supports add/edit/delete, computes base + optional totals, and can push
// the base total onto the job's contract amount.
import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, Alert, Switch
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Plus, Pencil } from 'lucide-react-native'
import {
  useQuoteItems, useAddQuoteItem, useUpdateQuoteItem, useDeleteQuoteItem,
  useApplyQuoteTotal, type QuoteItem
} from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground } from '../../components/ui'

function money(n: number) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function QuoteScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: items = [], isPending } = useQuoteItems(id)
  const addItem = useAddQuoteItem()
  const updateItem = useUpdateQuoteItem()
  const deleteItem = useDeleteQuoteItem()
  const applyTotal = useApplyQuoteTotal()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<QuoteItem | null>(null)
  const [desc, setDesc] = useState('')
  const [qty, setQty] = useState('1')
  const [rate, setRate] = useState('')
  const [unit, setUnit] = useState('')
  const [section, setSection] = useState('')
  const [optional, setOptional] = useState(false)
  const [excluded, setExcluded] = useState(false)
  const [saving, setSaving] = useState(false)

  const totals = useMemo(() => {
    let base = 0, optionalTotal = 0
    for (const it of items) {
      if (it.is_excluded) continue
      if (it.is_optional) optionalTotal += Number(it.amount || 0)
      else base += Number(it.amount || 0)
    }
    return { base, optionalTotal }
  }, [items])

  const sections = useMemo(() => {
    const map = new Map<string, QuoteItem[]>()
    for (const it of items) {
      const key = it.section || 'Scope of work'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return Array.from(map.entries())
  }, [items])

  function openAdd() {
    setEditing(null)
    setDesc(''); setQty('1'); setRate(''); setUnit(''); setSection('')
    setOptional(false); setExcluded(false); setOpen(true)
  }

  function openEdit(it: QuoteItem) {
    setEditing(it)
    setDesc(it.description || '')
    setQty(String(it.qty ?? 1))
    setRate(String(it.rate ?? ''))
    setUnit(it.unit || '')
    setSection(it.section || '')
    setOptional(!!it.is_optional)
    setExcluded(!!it.is_excluded)
    setOpen(true)
  }

  async function submit() {
    if (!desc.trim() || !user || saving) return
    const q = Number(qty.replace(/[^0-9.]/g, '')) || 0
    const r = Number(rate.replace(/[^0-9.]/g, '')) || 0
    const payload = {
      description: desc.trim(), qty: q, rate: r,
      unit: unit.trim() || undefined, section: section.trim() || undefined,
      isOptional: optional, isExcluded: excluded
    }
    setSaving(true)
    const { error } = editing
      ? await updateItem({ id: editing.id, jobId: id as string, item: payload })
      : await addItem({ userId: user.id, jobId: id as string, item: payload })
    setSaving(false)
    if (!error) setOpen(false)
  }

  function confirmDelete(itemId: string) {
    Alert.alert('Delete line item?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteItem({ id: itemId, jobId: id as string }) }
    ])
  }

  function applyToContract() {
    Alert.alert('Set contract amount?', `This sets the job's contract value to ${money(totals.base)} (base total).`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Set', onPress: () => applyTotal({ jobId: id as string, amount: totals.base }) }
    ])
  }

  return (
    <View className="flex-1">
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120, paddingHorizontal: 20 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#E8B865" size={20} />
          <Text className="text-gold-bright font-bold">Job</Text>
        </Pressable>

        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Estimate</Text>
        <Text className="text-ink text-3xl font-bold mb-5">Quote builder</Text>

        {isPending ? (
          <ActivityIndicator color="#E8B865" />
        ) : items.length === 0 ? (
          <Text className="text-ink-muted text-sm">No line items yet. Add your first below.</Text>
        ) : (
          sections.map(([sectionName, rows]) => (
            <View key={sectionName} className="mb-5">
              <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mb-2">{sectionName}</Text>
              <View style={{ gap: 8 }}>
                {rows.map((it) => (
                  <Pressable
                    key={it.id}
                    onPress={() => openEdit(it)}
                    onLongPress={() => confirmDelete(it.id)}
                    delayLongPress={350}
                    className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center"
                    style={{ gap: 10, opacity: it.is_excluded ? 0.5 : 1 }}
                  >
                    <View className="flex-1">
                      <Text className="text-ink text-sm font-semibold" numberOfLines={2}>{it.description}</Text>
                      <Text className="text-ink-muted text-xs mt-0.5">
                        {it.qty} {it.unit || ''} × {money(Number(it.rate || 0))}
                        {it.is_optional ? '  · optional' : ''}{it.is_excluded ? '  · excluded' : ''}
                      </Text>
                    </View>
                    <Text className="text-ink font-bold">{money(Number(it.amount || 0))}</Text>
                    <Pencil color="#9b948a" size={14} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
        {items.length > 0 ? (
          <Text className="text-ink-muted text-[10px]">Tap a line to edit · long-press to delete.</Text>
        ) : null}
      </ScrollView>

      {/* Totals + apply bar */}
      <View
        className="absolute left-0 right-0 bg-surface border-t border-[rgba(255,240,210,0.10)] px-5 pt-4 flex-row items-center"
        style={{ bottom: 0, paddingBottom: insets.bottom + 12, gap: 12 }}
      >
        <View className="flex-1">
          <Text className="text-ink-muted text-[10px] font-bold uppercase tracking-wider">Base total</Text>
          <Text className="text-gold-bright text-2xl font-bold">{money(totals.base)}</Text>
          {totals.optionalTotal ? (
            <Text className="text-ink-muted text-[11px]">+ {money(totals.optionalTotal)} optional</Text>
          ) : null}
        </View>
        <Pressable
          onPress={applyToContract}
          disabled={!items.length}
          className="rounded-xl px-4 py-3 items-center"
          style={{ backgroundColor: items.length ? 'rgba(232,184,101,0.18)' : 'rgba(232,184,101,0.08)' }}
        >
          <Text className="text-gold-bright font-bold text-sm">Set as contract</Text>
        </Pressable>
        <Pressable onPress={openAdd} className="rounded-full items-center justify-center" style={{ width: 50, height: 50, backgroundColor: '#E8B865' }}>
          <Plus color="#1A120A" size={24} strokeWidth={2.6} />
        </Pressable>
      </View>

      {/* Add/edit line item modal */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setOpen(false)} />
          <ScrollView
            className="bg-surface rounded-t-3xl border-t border-[rgba(255,240,210,0.10)]"
            contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
            style={{ maxHeight: '88%' }}
          >
            <Text className="text-ink text-xl font-bold mb-5">{editing ? 'Edit line item' : 'New line item'}</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Description</Text>
            <TextInput
              value={desc} onChangeText={setDesc} autoFocus={!editing}
              placeholder="Demo & haul-off, framing labor…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Qty</Text>
                <TextInput
                  value={qty} onChangeText={setQty} keyboardType="decimal-pad"
                  placeholder="1" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Rate</Text>
                <TextInput
                  value={rate} onChangeText={setRate} keyboardType="decimal-pad"
                  placeholder="$0" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View style={{ width: 80 }}>
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Unit</Text>
                <TextInput
                  value={unit} onChangeText={setUnit}
                  placeholder="ea, sf" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Section</Text>
            <TextInput
              value={section} onChangeText={setSection}
              placeholder="Scope of work, Upgrades…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-ink text-sm font-semibold">Optional upgrade</Text>
              <Switch value={optional} onValueChange={setOptional} trackColor={{ true: '#E8B865', false: '#3a352e' }} />
            </View>
            <View className="flex-row items-center justify-between py-2 mb-4">
              <Text className="text-ink text-sm font-semibold">Excluded (not in total)</Text>
              <Switch value={excluded} onValueChange={setExcluded} trackColor={{ true: '#E8B865', false: '#3a352e' }} />
            </View>
            <Pressable
              onPress={submit}
              disabled={saving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: saving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {saving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">{editing ? 'Save line item' : 'Add line item'}</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
