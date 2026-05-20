// mobile/app/jobs/[id].tsx — Job detail.
// Stack route pushed from the Jobs list / Home recent jobs. Shows the
// contact header (amount / paid / balance), client contact actions,
// a Log Payment flow, and the payments + schedule lists. Reuses the
// shared useJobDetail() + useLogPayment() hooks.
import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, Linking, Alert, Image
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import {
  ChevronLeft, Phone, Mail, Plus, Pencil, Trash2, Camera, Calendar, Users, User,
  CheckSquare, Square, FileText
} from 'lucide-react-native'
import {
  useJobDetail, useLogPayment, useUpdateStage, useUpdateJob,
  useAddExpense, useDeletePayment, useDeleteExpense, useDeleteJob,
  useJobPhotos, useUploadPhoto, useDeletePhoto,
  useAddSub, useDeleteSub, useClientsBundle,
  useAddTodo, useToggleTodo, useDeleteTodo,
  useAddNote, useDeleteNote,
  useCreateInvoice, useUpdateInvoiceStatus, useDeleteInvoice
} from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'

const INVOICE_TINT: Record<string, string> = {
  draft: '#5C5C5C', sent: '#6B7CA8', paid: '#4F8C5E', overdue: '#7d2a1f', void: '#5C5C5C'
}

const STAGE_TINT: Record<string, string> = {
  lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E',
  invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f'
}

const STAGES = ['lead', 'quote', 'job', 'invoice', 'closed', 'lost'] as const

function money(n: number) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function JobDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending } = useJobDetail(id)
  const logPayment = useLogPayment()
  const updateStage = useUpdateStage()
  const updateJob = useUpdateJob()
  const addExpense = useAddExpense()
  const deletePayment = useDeletePayment()
  const deleteExpense = useDeleteExpense()
  const deleteJob = useDeleteJob()
  const uploadPhoto = useUploadPhoto()
  const deletePhoto = useDeletePhoto()
  const addSub = useAddSub()
  const deleteSub = useDeleteSub()
  const addTodo = useAddTodo()
  const toggleTodo = useToggleTodo()
  const deleteTodo = useDeleteTodo()
  const addNote = useAddNote()
  const deleteNote = useDeleteNote()
  const createInvoice = useCreateInvoice()
  const updateInvoiceStatus = useUpdateInvoiceStatus()
  const deleteInvoice = useDeleteInvoice()
  const { data: photos = [] } = useJobPhotos(id)
  const { data: clientsBundle } = useClientsBundle(user?.id)

  const [photoBusy, setPhotoBusy] = useState(false)
  const [todoText, setTodoText] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [invOpen, setInvOpen] = useState(false)
  const [invTitle, setInvTitle] = useState('')
  const [invAmount, setInvAmount] = useState('')
  const [invSaving, setInvSaving] = useState(false)

  const [subOpen, setSubOpen] = useState(false)
  const [subName, setSubName] = useState('')
  const [subTrade, setSubTrade] = useState('')
  const [subPhone, setSubPhone] = useState('')
  const [subRate, setSubRate] = useState('')
  const [subSaving, setSubSaving] = useState(false)

  const [clientPickOpen, setClientPickOpen] = useState(false)

  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [paySaving, setPaySaving] = useState(false)
  const [stageSaving, setStageSaving] = useState<string | null>(null)

  const [expOpen, setExpOpen] = useState(false)
  const [expAmount, setExpAmount] = useState('')
  const [expCategory, setExpCategory] = useState('')
  const [expDesc, setExpDesc] = useState('')
  const [expSaving, setExpSaving] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  function openEdit() {
    if (!contact) return
    setEditName(contact.name || '')
    setEditTitle(contact.job_title || '')
    setEditPhone(contact.phone || '')
    setEditEmail(contact.email || '')
    setEditAmount(contact.amount != null ? String(contact.amount) : '')
    setEditNotes(contact.notes || '')
    setEditAddress(contact.address || '')
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!contact || editSaving) return
    setEditSaving(true)
    const amt = editAmount.trim() === '' ? null : Number(editAmount.replace(/[^0-9.]/g, ''))
    const { error } = await updateJob({
      contactId: contact.id,
      name: editName.trim(),
      jobTitle: editTitle.trim() || null,
      phone: editPhone.trim() || null,
      email: editEmail.trim() || null,
      amount: amt,
      notes: editNotes.trim() || null,
      address: editAddress.trim() || null
    })
    setEditSaving(false)
    if (!error) setEditOpen(false)
  }

  const contact = data?.contact ?? null
  const payments = data?.payments ?? []
  const expenses = data?.expenses ?? []
  const schedule = data?.schedule ?? []
  const subs = data?.subs ?? []
  const todos = data?.todos ?? []
  const notes = data?.notes ?? []
  const invoices = data?.invoices ?? []
  const clients = clientsBundle?.clients ?? []
  const linkedClient = contact?.client_id ? clients.find((c) => c.id === contact.client_id) ?? null : null

  async function submitTodo() {
    const text = todoText.trim()
    if (!text || !contact || !user) return
    setTodoText('')
    await addTodo({ userId: user.id, jobId: contact.id, text })
  }

  async function submitNote() {
    if (!noteText.trim() || !contact || !user || noteSaving) return
    setNoteSaving(true)
    const { error } = await addNote({ userId: user.id, contactId: contact.id, text: noteText.trim() })
    setNoteSaving(false)
    if (!error) { setNoteOpen(false); setNoteText('') }
  }

  function confirmDeleteNote(nid: string) {
    if (!contact) return
    Alert.alert('Delete note?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteNote({ id: nid, contactId: contact.id }) }
    ])
  }

  async function submitInvoice() {
    const amt = Number(invAmount.replace(/[^0-9.]/g, ''))
    if (!amt || !contact || !user || invSaving) return
    setInvSaving(true)
    const { error } = await createInvoice({ userId: user.id, contactId: contact.id, amount: amt, title: invTitle.trim() || undefined })
    setInvSaving(false)
    if (!error) { setInvOpen(false); setInvTitle(''); setInvAmount('') }
  }

  function cycleInvoiceStatus(inv: { id: string; status: string }) {
    if (!contact) return
    const order = ['draft', 'sent', 'paid']
    const next = order[(order.indexOf(inv.status) + 1) % order.length]
    updateInvoiceStatus({ id: inv.id, contactId: contact.id, status: next })
  }

  function confirmDeleteInvoice(iid: string) {
    if (!contact) return
    Alert.alert('Delete invoice?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteInvoice({ id: iid, contactId: contact.id }) }
    ])
  }

  async function submitSub() {
    if (!subName.trim() || !contact || !user || subSaving) return
    setSubSaving(true)
    const rate = subRate.trim() === '' ? undefined : Number(subRate.replace(/[^0-9.]/g, ''))
    const { error } = await addSub({
      userId: user.id, contactId: contact.id, name: subName.trim(),
      trade: subTrade.trim() || undefined, phone: subPhone.trim() || undefined, rate
    })
    setSubSaving(false)
    if (!error) {
      setSubOpen(false)
      setSubName(''); setSubTrade(''); setSubPhone(''); setSubRate('')
    }
  }

  function confirmDeleteSub(sid: string) {
    if (!contact) return
    Alert.alert('Remove sub?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteSub({ id: sid, contactId: contact.id }) }
    ])
  }

  async function linkClient(clientId: string | null) {
    if (!contact) return
    setClientPickOpen(false)
    await updateJob({ contactId: contact.id, clientId })
  }

  const totals = useMemo(() => {
    const amount = Number(contact?.amount || 0)
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const spent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
    return { amount, paid, balance: Math.max(0, amount - paid), spent }
  }, [contact, payments, expenses])

  async function submitExpense() {
    const amt = Number(expAmount.replace(/[^0-9.]/g, ''))
    if (!amt || !contact || !user || expSaving) return
    setExpSaving(true)
    const { error } = await addExpense({
      userId: user.id, contactId: contact.id, amount: amt,
      category: expCategory.trim() || undefined, description: expDesc.trim() || undefined
    })
    setExpSaving(false)
    if (!error) {
      setExpOpen(false)
      setExpAmount(''); setExpCategory(''); setExpDesc('')
    }
  }

  async function runPhotoUpload(uri: string) {
    if (!contact || !user) return
    setPhotoBusy(true)
    const { error } = await uploadPhoto({ userId: user.id, jobId: contact.id, uri })
    setPhotoBusy(false)
    if (error) Alert.alert("Couldn't upload photo", error.message)
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in Settings to attach photos.'); return }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 })
    if (!res.canceled && res.assets[0]) await runPhotoUpload(res.assets[0].uri)
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access in Settings to capture photos.'); return }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 })
    if (!res.canceled && res.assets[0]) await runPhotoUpload(res.assets[0].uri)
  }

  function addPhoto() {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: takePhoto },
      { text: 'Choose from library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  function confirmDeletePhoto(photoId: string, path: string) {
    if (!contact) return
    Alert.alert('Delete photo?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePhoto({ id: photoId, path, jobId: contact.id }) }
    ])
  }

  function confirmDeletePayment(pid: string) {
    if (!contact) return
    Alert.alert('Delete payment?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePayment({ id: pid, contactId: contact.id }) }
    ])
  }

  function confirmDeleteExpense(eid: string) {
    if (!contact) return
    Alert.alert('Delete expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteExpense({ id: eid, contactId: contact.id }) }
    ])
  }

  function confirmDeleteJob() {
    if (!contact) return
    Alert.alert('Delete job?', 'This permanently removes the job and its payments. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await deleteJob(contact.id)
          if (!error) { setEditOpen(false); router.back() }
        }
      }
    ])
  }

  async function changeStage(next: string) {
    if (!contact || next === contact.stage || stageSaving) return
    setStageSaving(next)
    await updateStage({ contactId: contact.id, stage: next })
    setStageSaving(null)
  }

  async function submitPayment() {
    const amt = Number(payAmount.replace(/[^0-9.]/g, ''))
    if (!amt || !contact || !user) return
    setPaySaving(true)
    const { error } = await logPayment({ contactId: contact.id, userId: user.id, amount: amt })
    setPaySaving(false)
    if (!error) {
      setPayOpen(false)
      setPayAmount('')
    }
  }

  if (isPending) {
    return (
      <View className="flex-1 bg-bg items-center justify-center"><ActivityIndicator color="#E8B865" /></View>
    )
  }
  if (!contact) {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-6" style={{ paddingTop: insets.top }}>
        <Pressable onPress={() => router.back()}><Text className="text-gold-bright font-bold">← Back</Text></Pressable>
        <Text className="text-ink-muted mt-4">Job not found.</Text>
      </View>
    )
  }

  const tint = STAGE_TINT[contact.stage ?? ''] ?? '#5C5C5C'

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} className="flex-row items-center" style={{ gap: 4 }}>
            <ChevronLeft color="#E8B865" size={20} />
            <Text className="text-gold-bright font-bold">Jobs</Text>
          </Pressable>
          <Pressable onPress={openEdit} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Pencil color="#E8B865" size={16} />
            <Text className="text-gold-bright font-bold">Edit</Text>
          </Pressable>
        </View>

        <Text className="text-ink text-3xl font-bold" numberOfLines={2}>{contact.name || 'Untitled'}</Text>
        <Text className="text-xs font-bold uppercase tracking-wider mt-1" style={{ color: tint }}>{contact.stage}</Text>
        {contact.job_title || contact.job_type ? (
          <Text className="text-ink-muted text-sm mt-1">{contact.job_title || contact.job_type}</Text>
        ) : null}

        {/* Money summary */}
        <View className="flex-row mt-5" style={{ gap: 10 }}>
          <Stat label="Contract" value={money(totals.amount)} />
          <Stat label="Paid" value={money(totals.paid)} tone="#4ade80" />
          <Stat label="Balance" value={money(totals.balance)} tone="#E8B865" />
        </View>

        {/* Stage progression */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-6 mb-2">Stage</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {STAGES.map((s) => {
            const active = contact.stage === s
            const chipTint = STAGE_TINT[s]
            return (
              <Pressable
                key={s}
                onPress={() => changeStage(s)}
                disabled={!!stageSaving}
                className="rounded-full px-3.5 py-2 border flex-row items-center"
                style={{
                  gap: 6,
                  borderColor: active ? chipTint : 'rgba(255,240,210,0.12)',
                  backgroundColor: active ? chipTint : 'transparent'
                }}
              >
                {stageSaving === s ? <ActivityIndicator size="small" color="#1A120A" /> : null}
                <Text
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: active ? '#1A120A' : '#9b948a' }}
                >
                  {s}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {/* Client link */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-2">Client</Text>
        <Pressable
          onPress={() => setClientPickOpen(true)}
          className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] flex-row items-center justify-between"
        >
          <View className="flex-row items-center flex-1" style={{ gap: 10 }}>
            <User color="#E8B865" size={16} />
            <Text className="text-ink text-base font-semibold" numberOfLines={1}>
              {linkedClient ? (linkedClient.name || 'Unnamed client') : 'No client linked'}
            </Text>
          </View>
          <Text className="text-gold-bright text-xs font-bold">{linkedClient ? 'Change' : 'Link'}</Text>
        </Pressable>

        {/* Todos */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">
          Punch list{todos.length ? ` · ${todos.filter((t) => t.done).length}/${todos.length}` : ''}
        </Text>
        <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
          <TextInput
            value={todoText}
            onChangeText={setTodoText}
            onSubmitEditing={submitTodo}
            returnKeyType="done"
            placeholder="Add a task…"
            placeholderTextColor="rgba(242,237,228,0.4)"
            className="flex-1 bg-surface border border-[rgba(255,240,210,0.10)] rounded-xl px-4 py-3 text-ink"
          />
          <Pressable onPress={submitTodo} className="rounded-xl items-center justify-center" style={{ width: 46, height: 46, backgroundColor: '#E8B865' }}>
            <Plus color="#1A120A" size={20} strokeWidth={2.6} />
          </Pressable>
        </View>
        {todos.length > 0 ? (
          <View style={{ gap: 6 }}>
            {todos.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => contact && toggleTodo({ id: t.id, jobId: contact.id, done: !t.done })}
                onLongPress={() => contact && deleteTodo({ id: t.id, jobId: contact.id })}
                delayLongPress={350}
                className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row items-center"
                style={{ gap: 10 }}
              >
                {t.done ? <CheckSquare color="#4F8C5E" size={18} /> : <Square color="#9b948a" size={18} />}
                <Text
                  className="flex-1 text-sm"
                  style={{ color: t.done ? '#9b948a' : '#F2EDE4', textDecorationLine: t.done ? 'line-through' : 'none' }}
                  numberOfLines={2}
                >
                  {t.text}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Photos */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Photos</Text>
          <Pressable onPress={addPhoto} disabled={photoBusy} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            {photoBusy ? <ActivityIndicator size="small" color="#E8B865" /> : <Camera color="#E8B865" size={14} />}
            <Text className="text-gold-bright text-xs font-bold">Add</Text>
          </Pressable>
        </View>
        {photos.length === 0 ? (
          <Text className="text-ink-muted text-sm">No photos yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {photos.map((ph) => (
              <Pressable key={ph.id} onLongPress={() => confirmDeletePhoto(ph.id, ph.path)} delayLongPress={350}>
                <Image
                  source={{ uri: ph.url }}
                  style={{ width: 120, height: 120, borderRadius: 14, backgroundColor: '#1B1816' }}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Contact actions */}
        {(contact.phone || contact.email) && (
          <View className="flex-row mt-4" style={{ gap: 10 }}>
            {contact.phone ? (
              <Action icon={<Phone color="#E8B865" size={16} />} label="Call" onPress={() => Linking.openURL(`tel:${contact.phone}`)} />
            ) : null}
            {contact.email ? (
              <Action icon={<Mail color="#E8B865" size={16} />} label="Email" onPress={() => Linking.openURL(`mailto:${contact.email}`)} />
            ) : null}
          </View>
        )}

        {/* Log payment */}
        <Pressable
          onPress={() => setPayOpen(true)}
          className="flex-row items-center justify-center rounded-2xl py-3.5 mt-5"
          style={{ gap: 6, backgroundColor: '#E8B865' }}
        >
          <Plus color="#1A120A" size={16} />
          <Text className="text-[#1A120A] font-bold">Log payment</Text>
        </Pressable>

        {/* Payments */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">Payments</Text>
        {payments.length === 0 ? (
          <Text className="text-ink-muted text-sm">No payments logged.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {payments.map((p) => (
              <Pressable
                key={p.id}
                onLongPress={() => confirmDeletePayment(p.id)}
                delayLongPress={350}
                className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row justify-between items-center"
              >
                <Text className="text-ink-muted text-sm">
                  {p.paid_on ? new Date(p.paid_on).toLocaleDateString() : '—'} · {p.method || 'payment'}
                </Text>
                <Text className="text-ink font-bold">{money(Number(p.amount || 0))}</Text>
              </Pressable>
            ))}
            <Text className="text-ink-muted text-[10px] mt-1">Long-press a payment to delete.</Text>
          </View>
        )}

        {/* Expenses */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">
            Expenses{totals.spent ? ` · ${money(totals.spent)}` : ''}
          </Text>
          <Pressable onPress={() => setExpOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Plus color="#E8B865" size={14} />
            <Text className="text-gold-bright text-xs font-bold">Add</Text>
          </Pressable>
        </View>
        {expenses.length === 0 ? (
          <Text className="text-ink-muted text-sm">No expenses logged.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {expenses.map((e) => (
              <Pressable
                key={e.id}
                onLongPress={() => confirmDeleteExpense(e.id)}
                delayLongPress={350}
                className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row justify-between items-center"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-ink text-sm font-semibold" numberOfLines={1}>
                    {e.category || e.description || 'Expense'}
                  </Text>
                  <Text className="text-ink-muted text-xs mt-0.5">
                    {e.expense_date ? new Date(e.expense_date).toLocaleDateString() : '—'}
                  </Text>
                </View>
                <Text className="text-ink font-bold">{money(Number(e.amount || 0))}</Text>
              </Pressable>
            ))}
            <Text className="text-ink-muted text-[10px] mt-1">Long-press an expense to delete.</Text>
          </View>
        )}

        {/* Invoices */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Invoices</Text>
          <Pressable onPress={() => setInvOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <FileText color="#E8B865" size={14} />
            <Text className="text-gold-bright text-xs font-bold">New</Text>
          </Pressable>
        </View>
        {invoices.length === 0 ? (
          <Text className="text-ink-muted text-sm">No invoices yet.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {invoices.map((inv) => {
              const tint = INVOICE_TINT[inv.status] ?? '#5C5C5C'
              return (
                <Pressable
                  key={inv.id}
                  onPress={() => cycleInvoiceStatus(inv)}
                  onLongPress={() => confirmDeleteInvoice(inv.id)}
                  delayLongPress={350}
                  className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-ink text-sm font-semibold" numberOfLines={1}>
                      {inv.title || `Invoice #${inv.sequence_number ?? ''}`}
                    </Text>
                    <Text className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: tint }}>{inv.status}</Text>
                  </View>
                  <Text className="text-ink font-bold">{money(Number(inv.amount || 0))}</Text>
                </Pressable>
              )
            })}
            <Text className="text-ink-muted text-[10px] mt-1">Tap to advance status · long-press to delete.</Text>
          </View>
        )}

        {/* Schedule */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">Schedule</Text>
        {schedule.length === 0 ? (
          <Text className="text-ink-muted text-sm">No events for this job.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {schedule.map((ev) => (
              <View key={ev.id} className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row items-center" style={{ gap: 10 }}>
                <Calendar color="#E8B865" size={16} />
                <View className="flex-1">
                  <Text className="text-ink text-sm font-semibold" numberOfLines={1}>{ev.title || 'Scheduled event'}</Text>
                  <Text className="text-ink-muted text-xs mt-0.5">
                    {ev.start_at ? new Date(ev.start_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Subs */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Subcontractors</Text>
          <Pressable onPress={() => setSubOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Plus color="#E8B865" size={14} />
            <Text className="text-gold-bright text-xs font-bold">Add</Text>
          </Pressable>
        </View>
        {subs.length === 0 ? (
          <Text className="text-ink-muted text-sm">No subs on this job.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {subs.map((s) => (
              <Pressable
                key={s.id}
                onLongPress={() => confirmDeleteSub(s.id)}
                delayLongPress={350}
                className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row items-center"
                style={{ gap: 10 }}
              >
                <Users color="#E8B865" size={16} />
                <View className="flex-1">
                  <Text className="text-ink text-sm font-semibold" numberOfLines={1}>{s.name || 'Subcontractor'}</Text>
                  <Text className="text-ink-muted text-xs mt-0.5" numberOfLines={1}>{s.trade || s.phone || '—'}</Text>
                </View>
                {s.rate != null ? <Text className="text-ink-muted text-sm">{money(Number(s.rate))}</Text> : null}
              </Pressable>
            ))}
            <Text className="text-ink-muted text-[10px] mt-1">Long-press a sub to remove.</Text>
          </View>
        )}

        {/* Job notes (single field) */}
        {contact.notes ? (
          <>
            <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-2">Job notes</Text>
            <Text className="text-ink text-sm">{contact.notes}</Text>
          </>
        ) : null}

        {/* Activity / notes timeline */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Activity</Text>
          <Pressable onPress={() => setNoteOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Plus color="#E8B865" size={14} />
            <Text className="text-gold-bright text-xs font-bold">Add note</Text>
          </Pressable>
        </View>
        {notes.length === 0 ? (
          <Text className="text-ink-muted text-sm">No activity logged.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {notes.map((n) => (
              <Pressable
                key={n.id}
                onLongPress={() => confirmDeleteNote(n.id)}
                delayLongPress={350}
                className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)]"
              >
                <Text className="text-ink text-sm">{n.text || '—'}</Text>
                <Text className="text-ink-muted text-[10px] mt-1">
                  {n.created_at ? new Date(n.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </Text>
              </Pressable>
            ))}
            <Text className="text-ink-muted text-[10px] mt-1">Long-press a note to delete.</Text>
          </View>
        )}
      </ScrollView>

      {/* Edit job modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setEditOpen(false)} />
          <ScrollView
            className="bg-surface rounded-t-3xl border-t border-[rgba(255,240,210,0.10)]"
            contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
            style={{ maxHeight: '85%' }}
          >
            <Text className="text-ink text-xl font-bold mb-5">Edit job</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Name</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Homeowner or company"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Job title</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Kitchen remodel, roof…"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Phone</Text>
                <TextInput
                  value={editPhone}
                  onChangeText={setEditPhone}
                  keyboardType="phone-pad"
                  placeholder="(555) 555-5555"
                  placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Value</Text>
                <TextInput
                  value={editAmount}
                  onChangeText={setEditAmount}
                  keyboardType="decimal-pad"
                  placeholder="$0"
                  placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Email</Text>
            <TextInput
              value={editEmail}
              onChangeText={setEditEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="name@email.com"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Address</Text>
            <TextInput
              value={editAddress}
              onChangeText={setEditAddress}
              placeholder="Job site address"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Notes</Text>
            <TextInput
              value={editNotes}
              onChangeText={setEditNotes}
              multiline
              placeholder="Anything worth remembering"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <Pressable
              onPress={submitEdit}
              disabled={editSaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: editSaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {editSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save changes</Text>}
            </Pressable>
            <Pressable
              onPress={confirmDeleteJob}
              className="flex-row items-center justify-center rounded-xl py-3.5 mt-3 border border-[rgba(232,90,87,0.3)]"
              style={{ gap: 6, backgroundColor: 'rgba(232,90,87,0.10)' }}
            >
              <Trash2 color="#f5a294" size={16} />
              <Text className="text-[#f5a294] font-bold">Delete job</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add sub modal */}
      <Modal visible={subOpen} transparent animationType="slide" onRequestClose={() => setSubOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setSubOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">Add subcontractor</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Name</Text>
            <TextInput
              value={subName} onChangeText={setSubName} autoFocus
              placeholder="Sub or company" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Trade</Text>
                <TextInput
                  value={subTrade} onChangeText={setSubTrade}
                  placeholder="Electrical, framing…" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View style={{ width: 110 }}>
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Rate</Text>
                <TextInput
                  value={subRate} onChangeText={setSubRate} keyboardType="decimal-pad"
                  placeholder="$0" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Phone</Text>
            <TextInput
              value={subPhone} onChangeText={setSubPhone} keyboardType="phone-pad"
              placeholder="(555) 555-5555" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
            />
            <Pressable
              onPress={submitSub}
              disabled={subSaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: subSaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {subSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Add sub</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Client picker modal */}
      <Modal visible={clientPickOpen} transparent animationType="slide" onRequestClose={() => setClientPickOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setClientPickOpen(false)} />
          <View className="bg-surface rounded-t-3xl border-t border-[rgba(255,240,210,0.10)]" style={{ maxHeight: '70%', paddingBottom: insets.bottom + 12 }}>
            <Text className="text-ink text-xl font-bold px-6 pt-6 pb-3">Link a client</Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, gap: 8, paddingBottom: 12 }}>
              <Pressable
                onPress={() => linkClient(null)}
                className="rounded-xl p-3 border border-[rgba(255,240,210,0.10)]"
              >
                <Text className="text-ink-muted font-semibold">No client</Text>
              </Pressable>
              {clients.map((c) => {
                const active = contact.client_id === c.id
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => linkClient(c.id)}
                    className="rounded-xl p-3 border flex-row items-center justify-between"
                    style={{ borderColor: active ? '#E8B865' : 'rgba(255,240,210,0.10)' }}
                  >
                    <Text className="text-ink font-semibold" numberOfLines={1}>{c.name || 'Unnamed client'}</Text>
                    {active ? <Text className="text-gold-bright text-xs font-bold">Linked</Text> : null}
                  </Pressable>
                )
              })}
              {clients.length === 0 ? (
                <Text className="text-ink-muted text-sm mt-2">No clients yet — create one from the Clients tab.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add note modal */}
      <Modal visible={noteOpen} transparent animationType="slide" onRequestClose={() => setNoteOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setNoteOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">Add note</Text>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              multiline
              autoFocus
              placeholder="What happened on the job?"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
              style={{ minHeight: 96, textAlignVertical: 'top' }}
            />
            <Pressable
              onPress={submitNote}
              disabled={noteSaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: noteSaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {noteSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save note</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* New invoice modal */}
      <Modal visible={invOpen} transparent animationType="slide" onRequestClose={() => setInvOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setInvOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-1">New invoice</Text>
            <Text className="text-ink-muted text-sm mb-5">Balance on this job: {money(totals.balance)}</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Title (optional)</Text>
            <TextInput
              value={invTitle}
              onChangeText={setInvTitle}
              placeholder="Deposit, progress draw, final…"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Amount</Text>
            <TextInput
              value={invAmount}
              onChangeText={setInvAmount}
              keyboardType="decimal-pad"
              placeholder="$0"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink text-2xl font-bold mb-5"
            />
            <Pressable
              onPress={submitInvoice}
              disabled={invSaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: invSaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {invSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Create invoice</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add expense modal */}
      <Modal visible={expOpen} transparent animationType="slide" onRequestClose={() => setExpOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setExpOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">Log an expense</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Amount</Text>
            <TextInput
              value={expAmount}
              onChangeText={setExpAmount}
              keyboardType="decimal-pad"
              placeholder="$0"
              placeholderTextColor="rgba(242,237,228,0.4)"
              autoFocus
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink text-2xl font-bold mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Category</Text>
            <TextInput
              value={expCategory}
              onChangeText={setExpCategory}
              placeholder="Materials, fuel, permit…"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Note (optional)</Text>
            <TextInput
              value={expDesc}
              onChangeText={setExpDesc}
              placeholder="What was it for?"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
            />
            <Pressable
              onPress={submitExpense}
              disabled={expSaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: expSaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {expSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save expense</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Log payment modal */}
      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setPayOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-1">Log a payment</Text>
            <Text className="text-ink-muted text-sm mb-5">Balance: {money(totals.balance)}</Text>
            <TextInput
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder="$0"
              placeholderTextColor="rgba(242,237,228,0.4)"
              autoFocus
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink text-2xl font-bold mb-5"
            />
            <Pressable
              onPress={submitPayment}
              disabled={paySaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: paySaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {paySaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save payment</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function Stat({ label, value, tone = '#F2EDE4' }: { label: string; value: string; tone?: string }) {
  return (
    <View className="flex-1 bg-surface rounded-2xl p-3 border border-[rgba(255,240,210,0.06)]">
      <Text className="text-lg font-bold" style={{ color: tone }} numberOfLines={1}>{value}</Text>
      <Text className="text-ink-muted text-[10px] font-semibold mt-1">{label}</Text>
    </View>
  )
}

function Action({ icon, label, onPress }: { icon: import('react').ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center rounded-xl py-3 border border-[rgba(232,184,101,0.3)]"
      style={{ gap: 6, backgroundColor: 'rgba(232,184,101,0.10)' }}
    >
      {icon}
      <Text className="text-gold-bright font-bold">{label}</Text>
    </Pressable>
  )
}
