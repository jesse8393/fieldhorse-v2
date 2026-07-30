// mobile/app/quote/[id].tsx, quote / estimate line item builder.
// id is the job (contact) id. Lists fh_quote_items grouped by section,
// supports add/edit/delete, computes base + optional totals, and can push
// the base total onto the job's contract amount.
import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, Alert, Switch
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { WebView } from 'react-native-webview'
import { ChevronLeft, Plus, Pencil, Eye, Share2, X, Send, Link as LinkIcon } from 'lucide-react-native'
import {
  useQuoteItems, useAddQuoteItem, useUpdateQuoteItem, useDeleteQuoteItem,
  useApplyQuoteTotal, useProfile, useJobDetail, type QuoteItem
} from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground } from '../../components/ui'
import { ShieldCheck } from 'lucide-react-native'
import { buildProposalHtml } from '../../lib/proposalHtml'
import { shareProposalPdf } from '../../lib/quotePdf'
import { sendProposalEmail } from '../../lib/sendDocs'
import { mintPublicLink } from '../../lib/publicLink'
import { approveQuoteVersion, type ApprovalMethod } from '../../lib/approveQuote'

function money(n: number) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function QuoteScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: items = [], isPending } = useQuoteItems(id)
  const { data: profile } = useProfile(user?.id)
  const { data: jobDetail } = useJobDetail(id)
  const addItem = useAddQuoteItem()
  const updateItem = useUpdateQuoteItem()
  const deleteItem = useDeleteQuoteItem()
  const applyTotal = useApplyQuoteTotal()

  const queryClient = useQueryClient()
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [busy, setBusy] = useState<null | 'send' | 'link'>(null)
  const hasBase = items.some((it) => !it.is_optional && !it.is_excluded)
  const contact = jobDetail?.contact || null
  const isApproved = (contact?.proposal_status || '').toLowerCase() === 'approved'

  // Approval modal state
  const [approveOpen, setApproveOpen] = useState(false)
  const [apprMethod, setApprMethod] = useState<ApprovalMethod>('verbal')
  const [apprName, setApprName] = useState('')
  const [apprEmail, setApprEmail] = useState('')
  const [apprNote, setApprNote] = useState('')
  const [apprSig, setApprSig] = useState('')
  const [approving, setApproving] = useState(false)

  function openApprove() {
    setApprMethod('verbal')
    setApprName(contact?.name || '')
    setApprEmail(contact?.email || '')
    setApprNote(''); setApprSig('')
    setApproveOpen(true)
  }
  async function onApprove() {
    if (approving || !user || !contact) return
    if (!apprName.trim()) { Alert.alert('Name required', 'Enter who approved the quote.'); return }
    setApproving(true)
    try {
      await approveQuoteVersion({
        userId: user.id,
        contact: contact as any,
        items: items as any,
        method: apprMethod,
        approvedByName: apprName,
        approvedByEmail: apprEmail,
        note: apprNote,
        signatureKind: apprMethod === 'signature_typed' ? 'typed' : null,
        signatureData: apprMethod === 'signature_typed' ? apprSig : null
      })
      queryClient.invalidateQueries({ queryKey: ['jobDetail', id] })
      queryClient.invalidateQueries({ queryKey: ['estimates'] })
      setApproveOpen(false)
      Alert.alert('Quote approved', 'A locked, signed version was saved as the approved baseline.')
    } catch (e: any) {
      Alert.alert("Couldn't approve", e?.message || 'Try again.')
    } finally {
      setApproving(false)
    }
  }

  function buildHtml() {
    return buildProposalHtml(
      (profile || {}) as any,
      (contact || {}) as any,
      items as any,
      { number: String(id || '').slice(0, 4).toUpperCase() || 'EST', issuedAt: new Date() }
    )
  }
  function filename() {
    return `Estimate_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`
  }

  async function onShare() {
    if (!hasBase || sharing) return
    setSharing(true)
    try {
      await shareProposalPdf(buildHtml(), filename())
    } catch (e: any) {
      Alert.alert("Couldn't create PDF", e?.message || 'Try again.')
    } finally {
      setSharing(false)
    }
  }

  async function onSendEmail() {
    if (!hasBase || busy || !user) return
    if (!(contact?.email || '').trim()) {
      Alert.alert('Add a client email first', 'Open the client and add an email, then send.')
      return
    }
    setBusy('send')
    try {
      const res = await sendProposalEmail({
        html: buildHtml(),
        filename: filename(),
        userId: user.id,
        contact: { id: String(id), name: contact?.name, email: contact?.email }
      })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['jobDetail', id] })
        queryClient.invalidateQueries({ queryKey: ['estimates'] })
        Alert.alert('Proposal sent', `Emailed to ${contact?.email}.`)
      } else {
        Alert.alert(res.notConfigured ? 'Saved to Files' : "Couldn't send", res.message || 'Try again.')
      }
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message || 'Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function onCopyLink() {
    if (busy || !user) return
    setBusy('link')
    try {
      const { url } = await mintPublicLink({ contactId: String(id), userId: user.id, kind: 'proposal' })
      await Clipboard.setStringAsync(url)
      Alert.alert('Share link copied', 'Paste it into a text or email, the customer can view and approve online.')
    } catch (e: any) {
      Alert.alert("Couldn't create link", e?.message || 'Try again.')
    } finally {
      setBusy(null)
    }
  }

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
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 120, paddingHorizontal: 24 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#C9963A" size={20} />
          <Text className="text-gold-bright font-bold">Job</Text>
        </Pressable>

        <Text className="text-gold-bright text-xs font-bold tracking-[2px] uppercase">Estimate</Text>
        <Text className="text-ink text-2xl font-bold mb-4">Quote builder</Text>

        {/* Customer facing actions, render in the design picked in
            Settings, then preview / share PDF / email / copy a link. */}
        <View className="mb-5" style={{ gap: 12 }}>
          <View className="flex-row" style={{ gap: 12 }}>
            <Pressable
              onPress={() => { if (hasBase) setPreviewHtml(buildHtml()) }}
              disabled={!hasBase}
              className="flex-1 flex-row items-center justify-center rounded-[10px] py-3 border border-[rgba(201, 150, 58,0.3)]"
              style={{ gap: 8, opacity: hasBase ? 1 : 0.45, backgroundColor: 'rgba(201, 150, 58,0.10)' }}
            >
              <Eye color="#C9963A" size={16} />
              <Text className="text-gold-bright font-bold text-sm">Preview</Text>
            </Pressable>
            <Pressable
              onPress={onShare}
              disabled={!hasBase || sharing}
              className="flex-1 flex-row items-center justify-center rounded-[10px] py-3 border border-[rgba(201, 150, 58,0.3)]"
              style={{ gap: 8, opacity: hasBase ? 1 : 0.45, backgroundColor: 'rgba(201, 150, 58,0.10)' }}
            >
              {sharing ? <ActivityIndicator color="#C9963A" /> : <><Share2 color="#C9963A" size={16} /><Text className="text-gold-bright font-bold text-sm">Share PDF</Text></>}
            </Pressable>
          </View>
          <View className="flex-row" style={{ gap: 12 }}>
            <Pressable
              onPress={onSendEmail}
              disabled={!hasBase || busy !== null}
              className="flex-1 flex-row items-center justify-center rounded-[10px] py-3"
              style={{ gap: 8, opacity: hasBase ? 1 : 0.45, backgroundColor: '#C9963A' }}
            >
              {busy === 'send' ? <ActivityIndicator color="#141414" /> : <><Send color="#141414" size={16} /><Text className="text-[#141414] font-bold text-sm">Send to client</Text></>}
            </Pressable>
            <Pressable
              onPress={onCopyLink}
              disabled={!hasBase || busy !== null}
              className="flex-1 flex-row items-center justify-center rounded-[10px] py-3 border border-[rgba(201, 150, 58,0.3)]"
              style={{ gap: 8, opacity: hasBase ? 1 : 0.45, backgroundColor: 'rgba(201, 150, 58,0.10)' }}
            >
              {busy === 'link' ? <ActivityIndicator color="#C9963A" /> : <><LinkIcon color="#C9963A" size={16} /><Text className="text-gold-bright font-bold text-sm">Copy link</Text></>}
            </Pressable>
          </View>
          <Pressable
            onPress={openApprove}
            disabled={!hasBase}
            className="flex-row items-center justify-center rounded-[10px] py-3"
            style={{ gap: 8, opacity: hasBase ? 1 : 0.45, backgroundColor: isApproved ? 'rgba(45, 122, 79,0.18)' : 'rgba(45, 122, 79,0.14)', borderWidth: 1, borderColor: 'rgba(45, 122, 79,0.5)' }}
          >
            <ShieldCheck color="#5C5C5C" size={16} />
            <Text style={{ color: '#5C5C5C', fontWeight: '700', fontSize: 14 }}>{isApproved ? 'Approved · record another' : 'Approve quote'}</Text>
          </Pressable>
        </View>

        {isPending ? (
          <ActivityIndicator color="#C9963A" />
        ) : items.length === 0 ? (
          <Text className="text-ink-muted text-sm">No line items yet. Add your first below.</Text>
        ) : (
          sections.map(([sectionName, rows]) => (
            <View key={sectionName} className="mb-5">
              <Text className="text-ink-muted text-xs font-bold tracking-[2px] uppercase mb-2">{sectionName}</Text>
              <View style={{ gap: 8 }}>
                {rows.map((it) => (
                  <Pressable
                    key={it.id}
                    onPress={() => openEdit(it)}
                    onLongPress={() => confirmDelete(it.id)}
                    delayLongPress={350}
                    className="bg-[rgba(20, 20, 20,0.6)] rounded-[10px] p-3 border border-[rgba(201, 150, 58,0.12)] flex-row items-center"
                    style={{ gap: 12, opacity: it.is_excluded ? 0.5 : 1 }}
                  >
                    <View className="flex-1">
                      <Text className="text-ink text-sm font-semibold" numberOfLines={2}>{it.description}</Text>
                      <Text className="text-ink-muted text-xs mt-0.5">
                        {it.qty} {it.unit || ''} × {money(Number(it.rate || 0))}
                        {it.is_optional ? '  · optional' : ''}{it.is_excluded ? '  · excluded' : ''}
                      </Text>
                    </View>
                    <Text className="text-ink font-bold">{money(Number(it.amount || 0))}</Text>
                    <Pencil color="#C9963A" size={14} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}
        {items.length > 0 ? (
          <Text className="text-ink-muted text-xs">Tap a line to edit · touch and hold to delete.</Text>
        ) : null}
      </ScrollView>

      {/* Totals + apply bar */}
      <View
        className="absolute left-0 right-0 bg-surface border-t border-[rgba(242, 237, 228,0.10)] px-4 pt-4 flex-row items-center"
        style={{ bottom: 0, paddingBottom: insets.bottom + 12, gap: 12 }}
      >
        <View className="flex-1">
          <Text className="text-ink-muted text-xs font-bold uppercase tracking-[0px]">Base total</Text>
          <Text className="text-gold-bright text-2xl font-bold">{money(totals.base)}</Text>
          {totals.optionalTotal ? (
            <Text className="text-ink-muted text-xs">+ {money(totals.optionalTotal)} optional</Text>
          ) : null}
        </View>
        <Pressable
          onPress={applyToContract}
          disabled={!items.length}
          className="rounded-[10px] px-4 py-3 items-center"
          style={{ backgroundColor: items.length ? 'rgba(201, 150, 58,0.18)' : 'rgba(201, 150, 58,0.08)' }}
        >
          <Text className="text-gold-bright font-bold text-sm">Set as contract</Text>
        </Pressable>
        <Pressable onPress={openAdd} className="rounded-[10px] items-center justify-center" style={{ width: 50, height: 50, backgroundColor: '#C9963A' }}>
          <Plus color="#141414" size={24} strokeWidth={2.6} />
        </Pressable>
      </View>

      {/* Add/edit line item modal */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setOpen(false)} />
          <ScrollView
            className="bg-surface rounded-t-[10px] border-t border-[rgba(242, 237, 228,0.10)]"
            contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
            style={{ maxHeight: '88%' }}
          >
            <Text className="text-ink text-xl font-bold mb-5">{editing ? 'Edit line item' : 'New line item'}</Text>
            <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Description</Text>
            <TextInput
              value={desc} onChangeText={setDesc} autoFocus={!editing}
              placeholder="Demo and hauling, framing labor…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Qty</Text>
                <TextInput
                  value={qty} onChangeText={setQty} keyboardType="decimal-pad"
                  placeholder="1" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Rate</Text>
                <TextInput
                  value={rate} onChangeText={setRate} keyboardType="decimal-pad"
                  placeholder="$0" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink"
                />
              </View>
              <View style={{ width: 80 }}>
                <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Unit</Text>
                <TextInput
                  value={unit} onChangeText={setUnit}
                  placeholder="ea, sf" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Section</Text>
            <TextInput
              value={section} onChangeText={setSection}
              placeholder="Scope of work, Upgrades…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-ink text-sm font-semibold">Optional upgrade</Text>
              <Switch value={optional} onValueChange={setOptional} trackColor={{ true: '#C9963A', false: '#141414' }} />
            </View>
            <View className="flex-row items-center justify-between py-2 mb-4">
              <Text className="text-ink text-sm font-semibold">Excluded (not in total)</Text>
              <Switch value={excluded} onValueChange={setExcluded} trackColor={{ true: '#C9963A', false: '#141414' }} />
            </View>
            <Pressable
              onPress={submit}
              disabled={saving}
              className="rounded-[10px] py-4 items-center"
              style={{ backgroundColor: saving ? 'rgba(201, 150, 58,0.5)' : '#C9963A' }}
            >
              {saving ? <ActivityIndicator color="#141414" /> : <Text className="text-[#141414] font-bold">{editing ? 'Save line item' : 'Add line item'}</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Estimate preview, renders the same HTML the PDF/website uses */}
      <Modal visible={!!previewHtml} animationType="slide" onRequestClose={() => setPreviewHtml(null)}>
        <View style={{ flex: 1, backgroundColor: '#141414' }}>
          <View style={{ paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#141414' }}>
            <Text style={{ color: '#F2EDE4', fontWeight: '700', fontSize: 16 }}>Estimate preview</Text>
            <Pressable onPress={() => setPreviewHtml(null)} hitSlop={12}><X color="#F2EDE4" size={22} /></Pressable>
          </View>
          {previewHtml ? (
            <WebView
              originWhitelist={['*']}
              source={{ html: previewHtml }}
              style={{ flex: 1, backgroundColor: '#141414' }}
              scalesPageToFit
            />
          ) : null}
          <View style={{ padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: '#141414' }}>
            <Pressable
              onPress={onShare}
              disabled={sharing}
              className="rounded-[10px] py-4 flex-row items-center justify-center"
              style={{ gap: 8, backgroundColor: '#C9963A' }}
            >
              {sharing ? <ActivityIndicator color="#141414" /> : <><Share2 color="#141414" size={18} /><Text className="text-[#141414] font-bold">Share PDF</Text></>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Approve quote */}
      <Modal visible={approveOpen} transparent animationType="slide" onRequestClose={() => setApproveOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setApproveOpen(false)} />
          <ScrollView className="bg-surface rounded-t-[10px] border-t border-[rgba(242, 237, 228,0.10)]" contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }} style={{ maxHeight: '90%' }}>
            <Text className="text-ink text-xl font-bold mb-1">Approve quote</Text>
            <Text className="text-ink-muted text-sm mb-5">Saves a locked, signed version as the approved baseline the job inherits.</Text>

            <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">How was it approved?</Text>
            <View className="flex-row flex-wrap mb-4" style={{ gap: 8 }}>
              {([['verbal', 'Verbal'], ['email', 'Email'], ['in_person', 'In person'], ['signature_typed', 'Typed signature']] as [ApprovalMethod, string][]).map(([m, label]) => {
                const on = apprMethod === m
                return (
                  <Pressable key={m} onPress={() => setApprMethod(m)} className="rounded-[10px] px-3 py-2" style={{ borderWidth: 1, borderColor: on ? '#5C5C5C' : '#141414', backgroundColor: on ? 'rgba(45, 122, 79,0.16)' : 'transparent' }}>
                    <Text style={{ color: on ? '#5C5C5C' : '#C9963A', fontSize: 14, fontWeight: '700' }}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>

            <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Approved by</Text>
            <TextInput value={apprName} onChangeText={setApprName} placeholder="Customer name" placeholderTextColor="rgba(242,237,228,0.4)" className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-4" />

            <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Email (optional)</Text>
            <TextInput value={apprEmail} onChangeText={setApprEmail} autoCapitalize="none" keyboardType="email-address" placeholder="customer@email.com" placeholderTextColor="rgba(242,237,228,0.4)" className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-4" />

            {apprMethod === 'signature_typed' ? (
              <>
                <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Typed signature</Text>
                <TextInput value={apprSig} onChangeText={setApprSig} placeholder="Type full name as signature" placeholderTextColor="rgba(242,237,228,0.4)" className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-4" style={{ fontStyle: 'italic' }} />
              </>
            ) : null}

            <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Note (optional)</Text>
            <TextInput value={apprNote} onChangeText={setApprNote} placeholder="Anything to record about the approval" placeholderTextColor="rgba(242,237,228,0.4)" multiline className="bg-bg border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-5" style={{ minHeight: 64, textAlignVertical: 'top' }} />

            <Pressable onPress={onApprove} disabled={approving} className="rounded-[10px] py-4 flex-row items-center justify-center" style={{ gap: 8, backgroundColor: approving ? 'rgba(45, 122, 79,0.5)' : '#2D7A4F' }}>
              {approving ? <ActivityIndicator color="#F2EDE4" /> : <><ShieldCheck color="#F2EDE4" size={18} /><Text style={{ color: '#F2EDE4', fontWeight: '800' }}>Approve & lock</Text></>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
