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
import * as DocumentPicker from 'expo-document-picker'
import {
  ChevronLeft, Phone, Mail, Plus, Pencil, Trash2, Camera, Calendar, Users, User,
  CheckSquare, Square, FileText, ClipboardCheck, Car, ShieldCheck, Flag, Paperclip, Download
} from 'lucide-react-native'
import {
  useJobDetail, useUpdateStage, useUpdateJob,
  useAddExpense, useDeletePayment, useDeleteExpense, useDeleteJob,
  useJobPhotos, useUploadPhoto, useDeletePhoto, useCaptionPhoto,
  useAddSub, useDeleteSub, useClientsBundle,
  useAddTodo, useToggleTodo, useDeleteTodo,
  useAddNote, useDeleteNote,
  useCreateInvoice, useUpdateInvoiceStatus, useDeleteInvoice,
  useAddChangeOrder, useUpdateChangeOrderStatus, useDeleteChangeOrder,
  useAddMileage, useDeleteMileage,
  useAddInspection, useUpdateInspectionResult, useDeleteInspection,
  useUpsertInsurance, useDeleteInsurance, useSaveMilestones, type Milestone,
  useJobFiles, useUploadFile, useDeleteFile, signJobFileUrl, type JobFile
} from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground } from '../../components/ui'
import { MarkCompleteSheet } from '../../components/MarkCompleteSheet'
import { PaymentSheet } from '../../components/PaymentSheet'
import { parseExpenseFromImage } from '../../lib/docIntelligence'

const INVOICE_TINT: Record<string, string> = {
  draft: '#5C5C5C', sent: '#6B7CA8', paid: '#4F8C5E', overdue: '#7d2a1f', void: '#5C5C5C'
}

const CO_TINT: Record<string, string> = {
  draft: '#C9963A', sent: '#6B7CA8', approved: '#4F8C5E', rejected: '#7d2a1f', void: '#5C5C5C'
}

const INSP_TINT: Record<string, string> = {
  pending: '#C9963A', pass: '#4F8C5E', fail: '#7d2a1f'
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
  const updateStage = useUpdateStage()
  const updateJob = useUpdateJob()
  const addExpense = useAddExpense()
  const deletePayment = useDeletePayment()
  const deleteExpense = useDeleteExpense()
  const deleteJob = useDeleteJob()
  const uploadPhoto = useUploadPhoto()
  const deletePhoto = useDeletePhoto()
  const captionPhoto = useCaptionPhoto()
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
  const addChangeOrder = useAddChangeOrder()
  const updateChangeOrderStatus = useUpdateChangeOrderStatus()
  const deleteChangeOrder = useDeleteChangeOrder()
  const addMileage = useAddMileage()
  const deleteMileage = useDeleteMileage()
  const addInspection = useAddInspection()
  const updateInspectionResult = useUpdateInspectionResult()
  const deleteInspection = useDeleteInspection()
  const upsertInsurance = useUpsertInsurance()
  const deleteInsurance = useDeleteInsurance()
  const saveMilestones = useSaveMilestones()
  const { data: photos = [] } = useJobPhotos(id)
  const { data: files = [] } = useJobFiles(id)
  const uploadFile = useUploadFile()
  const deleteFile = useDeleteFile()
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
  const [coOpen, setCoOpen] = useState(false)
  const [coTitle, setCoTitle] = useState('')
  const [coAmount, setCoAmount] = useState('')
  const [coDesc, setCoDesc] = useState('')
  const [coSaving, setCoSaving] = useState(false)
  const [milesOpen, setMilesOpen] = useState(false)
  const [milesVal, setMilesVal] = useState('')
  const [milesPurpose, setMilesPurpose] = useState('')
  const [milesSaving, setMilesSaving] = useState(false)
  const [inspOpen, setInspOpen] = useState(false)
  const [inspTrade, setInspTrade] = useState('')
  const [inspInspector, setInspInspector] = useState('')
  const [inspSaving, setInspSaving] = useState(false)

  const [subOpen, setSubOpen] = useState(false)
  const [subName, setSubName] = useState('')
  const [subTrade, setSubTrade] = useState('')
  const [subPhone, setSubPhone] = useState('')
  const [subRate, setSubRate] = useState('')
  const [subSaving, setSubSaving] = useState(false)

  const [milestoneText, setMilestoneText] = useState('')
  const [insOpen, setInsOpen] = useState(false)
  const [insForm, setInsForm] = useState({ claim_number: '', carrier: '', adjuster: '', deductible: '', rcv: '', acv: '', depreciation: '', supplement_amount: '', mortgage_company: '' })
  const [insSaving, setInsSaving] = useState(false)
  const [qtOpen, setQtOpen] = useState(false)
  const [qtForm, setQtForm] = useState({ scope: '', exclusions: '', terms: '' })
  const [qtSaving, setQtSaving] = useState(false)

  const [clientPickOpen, setClientPickOpen] = useState(false)

  const [payOpen, setPayOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [stageSaving, setStageSaving] = useState<string | null>(null)

  const [expOpen, setExpOpen] = useState(false)
  const [expAmount, setExpAmount] = useState('')
  const [expCategory, setExpCategory] = useState('')
  const [expDesc, setExpDesc] = useState('')
  const [expDate, setExpDate] = useState<string | null>(null)
  const [expSaving, setExpSaving] = useState(false)
  const [expScanning, setExpScanning] = useState(false)

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
  const changeOrders = data?.changeOrders ?? []
  const mileage = data?.mileage ?? []
  const inspections = data?.inspections ?? []
  const insurance = data?.insurance ?? null
  const milestones: Milestone[] = Array.isArray((contact as any)?.milestones) ? (contact as any).milestones : []

  async function addMilestone() {
    const txt = milestoneText.trim()
    if (!txt || !contact) return
    setMilestoneText('')
    await saveMilestones({ contactId: contact.id, milestones: [...milestones, { label: txt, done: false, created_at: new Date().toISOString() }] })
  }
  async function toggleMilestone(i: number) {
    if (!contact) return
    await saveMilestones({ contactId: contact.id, milestones: milestones.map((m, idx) => (idx === i ? { ...m, done: !m.done } : m)) })
  }
  async function removeMilestone(i: number) {
    if (!contact) return
    await saveMilestones({ contactId: contact.id, milestones: milestones.filter((_, idx) => idx !== i) })
  }
  function openInsurance() {
    setInsForm({
      claim_number: insurance?.claim_number || '', carrier: insurance?.carrier || '', adjuster: insurance?.adjuster || '',
      deductible: insurance?.deductible != null ? String(insurance.deductible) : '', rcv: insurance?.rcv != null ? String(insurance.rcv) : '',
      acv: insurance?.acv != null ? String(insurance.acv) : '', depreciation: insurance?.depreciation != null ? String(insurance.depreciation) : '',
      supplement_amount: insurance?.supplement_amount != null ? String(insurance.supplement_amount) : '', mortgage_company: insurance?.mortgage_company || ''
    })
    setInsOpen(true)
  }
  async function saveInsurance() {
    if (!contact || !user) return
    setInsSaving(true)
    const num = (v: string) => { const n = parseFloat(v.replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n }
    const { error } = await upsertInsurance({
      contactId: contact.id, userId: user.id, existingId: insurance?.id,
      patch: {
        claim_number: insForm.claim_number.trim() || null, carrier: insForm.carrier.trim() || null, adjuster: insForm.adjuster.trim() || null,
        deductible: num(insForm.deductible), rcv: num(insForm.rcv), acv: num(insForm.acv), depreciation: num(insForm.depreciation),
        supplement_amount: num(insForm.supplement_amount), mortgage_company: insForm.mortgage_company.trim() || null
      }
    })
    setInsSaving(false)
    if (error) { Alert.alert("Couldn't save insurance", error.message); return }
    setInsOpen(false)
  }
  function openQuoteTerms() {
    setQtForm({ scope: (contact as any)?.scope_text || '', exclusions: (contact as any)?.exclusions_text || '', terms: (contact as any)?.terms_text || '' })
    setQtOpen(true)
  }
  async function saveQuoteTerms() {
    if (!contact) return
    setQtSaving(true)
    const { error } = await updateJob({
      contactId: contact.id,
      scopeText: qtForm.scope.trim() || null,
      exclusionsText: qtForm.exclusions.trim() || null,
      termsText: qtForm.terms.trim() || null
    })
    setQtSaving(false)
    if (error) { Alert.alert("Couldn't save quote terms", error.message); return }
    setQtOpen(false)
  }
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

  async function submitChangeOrder() {
    const amt = Number(coAmount.replace(/[^0-9.]/g, ''))
    if (!coTitle.trim() || !contact || !user || coSaving) return
    setCoSaving(true)
    const { error } = await addChangeOrder({ userId: user.id, contactId: contact.id, title: coTitle.trim(), amount: amt, description: coDesc.trim() || undefined })
    setCoSaving(false)
    if (!error) { setCoOpen(false); setCoTitle(''); setCoAmount(''); setCoDesc('') }
  }

  function cycleChangeOrder(co: { id: string; status: string }) {
    if (!contact) return
    const order = ['draft', 'approved', 'rejected']
    const idx = order.indexOf(co.status)
    const next = order[(idx === -1 ? 0 : idx + 1) % order.length]
    updateChangeOrderStatus({
      id: co.id,
      contactId: contact.id,
      status: next,
      approvedByName: next === 'approved' ? (contact.name || null) : null
    })
  }

  function confirmDeleteChangeOrder(cid: string) {
    if (!contact) return
    Alert.alert('Delete change order?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteChangeOrder({ id: cid, contactId: contact.id }) }
    ])
  }

  async function submitMileage() {
    const m = Number(milesVal.replace(/[^0-9.]/g, ''))
    if (!m || !contact || !user || milesSaving) return
    setMilesSaving(true)
    const { error } = await addMileage({ userId: user.id, contactId: contact.id, miles: m, purpose: milesPurpose.trim() || undefined })
    setMilesSaving(false)
    if (!error) { setMilesOpen(false); setMilesVal(''); setMilesPurpose('') }
  }

  function confirmDeleteMileage(mid: string) {
    if (!contact) return
    Alert.alert('Delete trip?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMileage({ id: mid, contactId: contact.id }) }
    ])
  }

  async function submitInspection() {
    if (!inspTrade.trim() || !contact || !user || inspSaving) return
    setInspSaving(true)
    const { error } = await addInspection({ userId: user.id, contactId: contact.id, trade: inspTrade.trim(), inspector: inspInspector.trim() || undefined })
    setInspSaving(false)
    if (!error) { setInspOpen(false); setInspTrade(''); setInspInspector('') }
  }

  function cycleInspection(insp: { id: string; result: string | null }) {
    if (!contact) return
    const order = ['pending', 'pass', 'fail']
    const cur = insp.result || 'pending'
    const next = order[(order.indexOf(cur) + 1) % order.length]
    updateInspectionResult({ id: insp.id, contactId: contact.id, result: next })
  }

  function confirmDeleteInspection(iid: string) {
    if (!contact) return
    Alert.alert('Delete inspection?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteInspection({ id: iid, contactId: contact.id }) }
    ])
  }

  const mileageTotal = mileage.reduce((s, m) => s + Number(m.miles || 0), 0)

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
    const approvedCO = changeOrders.reduce((s, co) => s + (co.status === 'approved' ? Number(co.amount || 0) : 0), 0)
    const contractTotal = amount + approvedCO
    const invoiced = invoices.reduce((s, inv) => s + (inv.status === 'void' ? 0 : Number(inv.amount || 0)), 0)
    return { amount, paid, balance: Math.max(0, amount - paid), spent, contractTotal, approvedCO, invoiced }
  }, [contact, payments, expenses, changeOrders, invoices])

  async function submitExpense() {
    const amt = Number(expAmount.replace(/[^0-9.]/g, ''))
    if (!amt || !contact || !user || expSaving) return
    setExpSaving(true)
    const { error } = await addExpense({
      userId: user.id, contactId: contact.id, amount: amt,
      category: expCategory.trim() || undefined, description: expDesc.trim() || undefined,
      expenseDate: expDate || undefined
    })
    setExpSaving(false)
    if (!error) {
      setExpOpen(false)
      setExpAmount(''); setExpCategory(''); setExpDesc(''); setExpDate(null)
    }
  }

  async function scanReceipt(fromCamera: boolean) {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert('Permission needed', `Allow ${fromCamera ? 'camera' : 'photo'} access to scan a receipt.`); return }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.5 })
      if (res.canceled || !res.assets?.[0]?.base64) return
      const a = res.assets[0]
      setExpScanning(true)
      const parsed = await parseExpenseFromImage(`data:${a.mimeType || 'image/jpeg'};base64,${a.base64}`)
      if (parsed.amount) setExpAmount(String(parsed.amount))
      if (parsed.category) setExpCategory(parsed.category)
      if (parsed.description) setExpDesc(parsed.description)
      if (parsed.expense_date) setExpDate(parsed.expense_date)
    } catch (e) {
      Alert.alert('Scan failed', (e as Error).message || 'Could not read that receipt.')
    } finally {
      setExpScanning(false)
    }
  }

  function promptScanReceipt() {
    Alert.alert('Scan a receipt', 'Photograph a receipt and AI will fill the expense.', [
      { text: 'Take photo', onPress: () => scanReceipt(true) },
      { text: 'Choose from library', onPress: () => scanReceipt(false) },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  async function runPhotoUpload(uri: string, base64?: string | null) {
    if (!contact || !user) return
    setPhotoBusy(true)
    const { error, id } = await uploadPhoto({ userId: user.id, jobId: contact.id, uri })
    setPhotoBusy(false)
    if (error) { Alert.alert("Couldn't upload photo", error.message); return }
    // Auto-caption in the background — never blocks the upload.
    if (id && base64) {
      captionPhoto({ rowId: id, jobId: contact.id, imageBase64: base64, mediaType: 'image/jpeg' })
    }
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in Settings to attach photos.'); return }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true })
    if (!res.canceled && res.assets[0]) await runPhotoUpload(res.assets[0].uri, res.assets[0].base64)
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access in Settings to capture photos.'); return }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true })
    if (!res.canceled && res.assets[0]) await runPhotoUpload(res.assets[0].uri, res.assets[0].base64)
  }

  function addPhoto() {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: takePhoto },
      { text: 'Choose from library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  const [fileBusy, setFileBusy] = useState(false)
  async function pickFile() {
    if (!contact || !user) return
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
    if (res.canceled || !res.assets?.[0]) return
    const a = res.assets[0]
    setFileBusy(true)
    const { error } = await uploadFile({ userId: user.id, jobId: contact.id, uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })
    setFileBusy(false)
    if (error) Alert.alert("Couldn't upload file", error.message)
  }
  async function openFile(f: JobFile) {
    const url = await signJobFileUrl(f.storage_path)
    if (!url) { Alert.alert("Couldn't open file", 'The signed link could not be created.'); return }
    Linking.openURL(url)
  }
  function confirmDeleteFile(f: JobFile) {
    if (!contact) return
    Alert.alert('Delete file?', `Removing ${f.filename || 'this file'} from storage. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteFile({ id: f.id, path: f.storage_path, jobId: contact.id }) }
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

  if (isPending) {
    return (
      <View className="flex-1 bg-bg items-center justify-center"><ActivityIndicator color="#C9963A" /></View>
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
    <View className="flex-1">
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} className="flex-row items-center" style={{ gap: 4 }}>
            <ChevronLeft color="#C9963A" size={20} />
            <Text className="text-gold-bright font-bold">Jobs</Text>
          </Pressable>
          <Pressable onPress={openEdit} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Pencil color="#C9963A" size={16} />
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
          <Stat label="Balance" value={money(totals.balance)} tone="#C9963A" />
        </View>

        {/* Quote builder */}
        <Pressable
          onPress={() => router.push(`/quote/${contact.id}`)}
          className="flex-row items-center justify-center rounded-2xl py-3 mt-3 border border-[rgba(232,184,101,0.3)]"
          style={{ gap: 6, backgroundColor: 'rgba(232,184,101,0.10)' }}
        >
          <FileText color="#C9963A" size={16} />
          <Text className="text-gold-bright font-bold">Build estimate</Text>
        </Pressable>

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

        {contact.stage !== 'closed' && contact.stage !== 'lost' ? (
          <Pressable
            onPress={() => setCompleteOpen(true)}
            className="rounded-2xl py-3.5 mt-3 items-center flex-row justify-center border"
            style={{ gap: 8, borderColor: 'rgba(79,140,94,0.4)', backgroundColor: 'rgba(79,140,94,0.12)' }}
          >
            <Flag color="#5BB97A" size={16} />
            <Text className="font-bold" style={{ color: '#5BB97A' }}>Mark complete</Text>
          </Pressable>
        ) : null}

        {/* Client link */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-2">Client</Text>
        <Pressable
          onPress={() => setClientPickOpen(true)}
          className="bg-[rgba(24,20,17,0.6)] rounded-2xl p-4 border border-[rgba(232,184,101,0.12)] flex-row items-center justify-between"
        >
          <View className="flex-row items-center flex-1" style={{ gap: 10 }}>
            <User color="#C9963A" size={16} />
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
          <Pressable onPress={submitTodo} className="rounded-xl items-center justify-center" style={{ width: 46, height: 46, backgroundColor: '#C9963A' }}>
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
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center"
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
            {photoBusy ? <ActivityIndicator size="small" color="#C9963A" /> : <Camera color="#C9963A" size={14} />}
            <Text className="text-gold-bright text-xs font-bold">Add</Text>
          </Pressable>
        </View>
        {photos.length === 0 ? (
          <Text className="text-ink-muted text-sm">No photos yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {photos.map((ph) => (
              <Pressable key={ph.id} onLongPress={() => confirmDeletePhoto(ph.id, ph.path)} delayLongPress={350} style={{ width: 120 }}>
                <Image
                  source={{ uri: ph.url }}
                  style={{ width: 120, height: 120, borderRadius: 14, backgroundColor: '#1B1816' }}
                />
                {ph.caption ? (
                  <Text className="text-ink-muted text-[11px] mt-1.5" numberOfLines={2}>{ph.caption}</Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Files */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Files</Text>
          <Pressable onPress={pickFile} disabled={fileBusy} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            {fileBusy ? <ActivityIndicator size="small" color="#C9963A" /> : <Paperclip color="#C9963A" size={14} />}
            <Text className="text-gold-bright text-xs font-bold">Upload</Text>
          </Pressable>
        </View>
        {files.length === 0 ? (
          <Text className="text-ink-muted text-sm">No files yet. Attach contracts, permits, or PDFs.</Text>
        ) : (
          <View style={{ gap: 6 }}>
            {files.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => openFile(f)}
                onLongPress={() => confirmDeleteFile(f)}
                delayLongPress={350}
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center"
                style={{ gap: 10 }}
              >
                <FileText color="#C9963A" size={16} />
                <View className="flex-1">
                  <Text className="text-ink text-sm font-semibold" numberOfLines={1}>{f.filename || 'Document'}</Text>
                  <Text className="text-ink-muted text-xs mt-0.5">
                    {fmtSize(f.size_bytes)}{f.uploaded_at ? ` · ${new Date(f.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                  </Text>
                </View>
                <Download color="#9b948a" size={16} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Contact actions */}
        {(contact.phone || contact.email) && (
          <View className="flex-row mt-4" style={{ gap: 10 }}>
            {contact.phone ? (
              <Action icon={<Phone color="#C9963A" size={16} />} label="Call" onPress={() => Linking.openURL(`tel:${contact.phone}`)} />
            ) : null}
            {contact.email ? (
              <Action icon={<Mail color="#C9963A" size={16} />} label="Email" onPress={() => Linking.openURL(`mailto:${contact.email}`)} />
            ) : null}
          </View>
        )}

        {/* Log payment */}
        <Pressable
          onPress={() => setPayOpen(true)}
          className="flex-row items-center justify-center rounded-2xl py-3.5 mt-5"
          style={{ gap: 6, backgroundColor: '#C9963A' }}
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
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row justify-between items-center"
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
            <Plus color="#C9963A" size={14} />
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
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row justify-between items-center"
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
            <FileText color="#C9963A" size={14} />
            <Text className="text-gold-bright text-xs font-bold">New</Text>
          </Pressable>
        </View>
        {totals.contractTotal > 0 ? (
          <View className="bg-[rgba(24,20,17,0.6)] rounded-2xl p-4 border border-[rgba(232,184,101,0.12)] mb-3">
            <View className="flex-row flex-wrap" style={{ gap: 18 }}>
              <InsStat label="Contract" value={money(totals.contractTotal)} />
              <InsStat label="Invoiced" value={money(totals.invoiced)} />
              <InsStat label="Paid" value={money(totals.paid)} />
              <InsStat label="Balance" value={money(Math.max(0, totals.contractTotal - totals.paid))} />
            </View>
            {totals.approvedCO > 0 ? <Text className="text-ink-muted text-[10px] mt-3">Includes {money(totals.approvedCO)} in approved change orders.</Text> : null}
          </View>
        ) : null}
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
                  className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center justify-between"
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

        {/* Change orders */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Change orders</Text>
          <Pressable onPress={() => setCoOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Plus color="#C9963A" size={14} />
            <Text className="text-gold-bright text-xs font-bold">New</Text>
          </Pressable>
        </View>
        {changeOrders.length === 0 ? (
          <Text className="text-ink-muted text-sm">No change orders.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {changeOrders.map((co) => {
              const tint = CO_TINT[co.status] ?? '#5C5C5C'
              return (
                <Pressable
                  key={co.id}
                  onPress={() => cycleChangeOrder(co)}
                  onLongPress={() => confirmDeleteChangeOrder(co.id)}
                  delayLongPress={350}
                  className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-ink text-sm font-semibold" numberOfLines={1}>{co.title}</Text>
                    <Text className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: tint }}>
                      {co.status}{co.status === 'approved' && (co as any).approved_by_name ? ` · ${(co as any).approved_by_name}` : ''}
                    </Text>
                  </View>
                  <Text className="text-ink font-bold">{money(Number(co.amount || 0))}</Text>
                </Pressable>
              )
            })}
            <Text className="text-ink-muted text-[10px] mt-1">Tap to advance status · long-press to delete.</Text>
          </View>
        )}

        {/* Inspections */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Inspections</Text>
          <Pressable onPress={() => setInspOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <ClipboardCheck color="#C9963A" size={14} />
            <Text className="text-gold-bright text-xs font-bold">Add</Text>
          </Pressable>
        </View>
        {inspections.length === 0 ? (
          <Text className="text-ink-muted text-sm">No inspections.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {inspections.map((insp) => {
              const result = insp.result || 'pending'
              const tint = INSP_TINT[result] ?? '#5C5C5C'
              return (
                <Pressable
                  key={insp.id}
                  onPress={() => cycleInspection(insp)}
                  onLongPress={() => confirmDeleteInspection(insp.id)}
                  delayLongPress={350}
                  className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-ink text-sm font-semibold" numberOfLines={1}>{insp.trade || 'Inspection'}</Text>
                    <Text className="text-ink-muted text-xs mt-0.5" numberOfLines={1}>{insp.inspector || '—'}</Text>
                  </View>
                  <Text className="text-[10px] font-bold uppercase tracking-wider" style={{ color: tint }}>{result}</Text>
                </Pressable>
              )
            })}
            <Text className="text-ink-muted text-[10px] mt-1">Tap to cycle result · long-press to delete.</Text>
          </View>
        )}

        {/* Mileage */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">
            Mileage{mileageTotal ? ` · ${mileageTotal} mi` : ''}
          </Text>
          <Pressable onPress={() => setMilesOpen(true)} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Car color="#C9963A" size={14} />
            <Text className="text-gold-bright text-xs font-bold">Log</Text>
          </Pressable>
        </View>
        {mileage.length === 0 ? (
          <Text className="text-ink-muted text-sm">No trips logged.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {mileage.map((m) => (
              <Pressable
                key={m.id}
                onLongPress={() => confirmDeleteMileage(m.id)}
                delayLongPress={350}
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center justify-between"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-ink text-sm font-semibold">{m.miles} mi</Text>
                  <Text className="text-ink-muted text-xs mt-0.5" numberOfLines={1}>
                    {m.drove_on ? new Date(m.drove_on).toLocaleDateString() : '—'}{m.purpose ? ` · ${m.purpose}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
            <Text className="text-ink-muted text-[10px] mt-1">Long-press a trip to delete.</Text>
          </View>
        )}

        {/* Quote terms */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Quote terms</Text>
          <Pressable onPress={openQuoteTerms} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Pencil color="#C9963A" size={13} />
            <Text className="text-gold-bright text-xs font-bold">Edit</Text>
          </Pressable>
        </View>
        {(() => {
          const c = contact as any
          const hasTerms = c?.scope_text || c?.exclusions_text || c?.terms_text
          if (!hasTerms) {
            return (
              <Pressable onPress={openQuoteTerms} className="bg-[rgba(24,20,17,0.6)] rounded-xl p-4 border border-[rgba(232,184,101,0.12)] flex-row items-center" style={{ gap: 10 }}>
                <FileText color="#C9963A" size={16} />
                <Text className="text-ink-muted text-sm flex-1">Add scope, exclusions & payment terms — they flow onto every proposal.</Text>
              </Pressable>
            )
          }
          return (
            <View className="bg-[rgba(24,20,17,0.6)] rounded-2xl p-4 border border-[rgba(232,184,101,0.12)]" style={{ gap: 12 }}>
              {c?.scope_text ? <QuoteTermBlock label="Scope of work" text={c.scope_text} /> : null}
              {c?.exclusions_text ? <QuoteTermBlock label="Exclusions" text={c.exclusions_text} /> : null}
              {c?.terms_text ? <QuoteTermBlock label="Payment terms" text={c.terms_text} /> : null}
            </View>
          )
        })()}

        {/* Milestones */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">
          Milestones{milestones.length ? ` · ${milestones.filter((m) => m.done).length}/${milestones.length}` : ''}
        </Text>
        <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
          <TextInput
            value={milestoneText}
            onChangeText={setMilestoneText}
            onSubmitEditing={addMilestone}
            returnKeyType="done"
            placeholder="Add a checkpoint…"
            placeholderTextColor="rgba(242,237,228,0.4)"
            className="flex-1 bg-surface border border-[rgba(255,240,210,0.10)] rounded-xl px-4 py-3 text-ink"
          />
          <Pressable onPress={addMilestone} className="rounded-xl items-center justify-center" style={{ width: 46, height: 46, backgroundColor: '#C9963A' }}>
            <Plus color="#1A120A" size={20} strokeWidth={2.6} />
          </Pressable>
        </View>
        {milestones.length > 0 ? (
          <View style={{ gap: 6 }}>
            {milestones.map((m, i) => (
              <Pressable
                key={`${m.created_at}-${i}`}
                onPress={() => toggleMilestone(i)}
                onLongPress={() => removeMilestone(i)}
                delayLongPress={350}
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center"
                style={{ gap: 10 }}
              >
                {m.done ? <CheckSquare color="#4F8C5E" size={18} /> : <Square color="#9b948a" size={18} />}
                <Flag color={m.done ? '#4F8C5E' : '#C9963A'} size={13} />
                <Text className="flex-1 text-sm" style={{ color: m.done ? '#9b948a' : '#F2EDE4', textDecorationLine: m.done ? 'line-through' : 'none' }} numberOfLines={2}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Insurance claim */}
        <View className="flex-row items-center justify-between mt-7 mb-3">
          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase">Insurance claim</Text>
          <Pressable onPress={openInsurance} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Pencil color="#C9963A" size={13} />
            <Text className="text-gold-bright text-xs font-bold">{insurance ? 'Edit' : 'Add'}</Text>
          </Pressable>
        </View>
        {!insurance ? (
          <Pressable onPress={openInsurance} className="bg-[rgba(24,20,17,0.6)] rounded-xl p-4 border border-[rgba(232,184,101,0.12)] flex-row items-center" style={{ gap: 10 }}>
            <ShieldCheck color="#C9963A" size={16} />
            <Text className="text-ink-muted text-sm flex-1">Track a carrier claim — surfaces RCV / ACV, deductible & supplement.</Text>
          </Pressable>
        ) : (
          <Pressable onPress={openInsurance} className="bg-[rgba(24,20,17,0.6)] rounded-2xl p-4 border border-[rgba(232,184,101,0.12)]">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <ShieldCheck color="#C9963A" size={16} />
              <Text className="text-ink text-base font-semibold flex-1" numberOfLines={1}>{insurance.carrier || 'Carrier'}{insurance.claim_number ? ` · ${insurance.claim_number}` : ''}</Text>
            </View>
            {insurance.adjuster ? <Text className="text-ink-muted text-xs mt-1">{insurance.adjuster}</Text> : null}
            <View className="flex-row flex-wrap mt-3" style={{ gap: 14 }}>
              {insurance.rcv != null ? <InsStat label="RCV" value={money(insurance.rcv)} /> : null}
              {insurance.acv != null ? <InsStat label="ACV" value={money(insurance.acv)} /> : null}
              {insurance.deductible != null ? <InsStat label="Deductible" value={money(insurance.deductible)} /> : null}
              {insurance.depreciation != null ? <InsStat label="Depreciation" value={money(insurance.depreciation)} /> : null}
              {insurance.supplement_amount != null && Number(insurance.supplement_amount) > 0 ? <InsStat label="Supplement" value={money(insurance.supplement_amount)} /> : null}
            </View>
            {insurance.mortgage_company ? <Text className="text-ink-muted text-xs mt-3">Mortgage: {insurance.mortgage_company}</Text> : null}
          </Pressable>
        )}

        {/* Schedule */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">Schedule</Text>
        {schedule.length === 0 ? (
          <Text className="text-ink-muted text-sm">No events for this job.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {schedule.map((ev) => (
              <View key={ev.id} className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center" style={{ gap: 10 }}>
                <Calendar color="#C9963A" size={16} />
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
            <Plus color="#C9963A" size={14} />
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
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)] flex-row items-center"
                style={{ gap: 10 }}
              >
                <Users color="#C9963A" size={16} />
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
            <Plus color="#C9963A" size={14} />
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
                className="bg-[rgba(24,20,17,0.6)] rounded-xl p-3 border border-[rgba(232,184,101,0.12)]"
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
              style={{ backgroundColor: editSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
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
              style={{ backgroundColor: subSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
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
                    style={{ borderColor: active ? '#C9963A' : 'rgba(255,240,210,0.10)' }}
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
              style={{ backgroundColor: noteSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
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
              style={{ backgroundColor: invSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
            >
              {invSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Create invoice</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* New change order modal */}
      <Modal visible={coOpen} transparent animationType="slide" onRequestClose={() => setCoOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setCoOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">New change order</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Title</Text>
            <TextInput
              value={coTitle} onChangeText={setCoTitle} autoFocus
              placeholder="Added scope, upgrade…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Amount</Text>
            <TextInput
              value={coAmount} onChangeText={setCoAmount} keyboardType="decimal-pad"
              placeholder="$0" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink text-2xl font-bold mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Description (optional)</Text>
            <TextInput
              value={coDesc} onChangeText={setCoDesc} multiline
              placeholder="What changed and why" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <Pressable onPress={submitChangeOrder} disabled={coSaving} className="rounded-xl py-4 items-center" style={{ backgroundColor: coSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}>
              {coSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Create change order</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Log mileage modal */}
      <Modal visible={milesOpen} transparent animationType="slide" onRequestClose={() => setMilesOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setMilesOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">Log mileage</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Miles</Text>
            <TextInput
              value={milesVal} onChangeText={setMilesVal} keyboardType="decimal-pad" autoFocus
              placeholder="0" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink text-2xl font-bold mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Purpose (optional)</Text>
            <TextInput
              value={milesPurpose} onChangeText={setMilesPurpose}
              placeholder="Supply run, site visit…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
            />
            <Pressable onPress={submitMileage} disabled={milesSaving} className="rounded-xl py-4 items-center" style={{ backgroundColor: milesSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}>
              {milesSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Log trip</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add inspection modal */}
      <Modal visible={inspOpen} transparent animationType="slide" onRequestClose={() => setInspOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setInspOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">Add inspection</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Trade / type</Text>
            <TextInput
              value={inspTrade} onChangeText={setInspTrade} autoFocus
              placeholder="Framing, electrical, final…" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Inspector (optional)</Text>
            <TextInput
              value={inspInspector} onChangeText={setInspInspector}
              placeholder="Name or agency" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
            />
            <Pressable onPress={submitInspection} disabled={inspSaving} className="rounded-xl py-4 items-center" style={{ backgroundColor: inspSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}>
              {inspSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Add inspection</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add expense modal */}
      <Modal visible={expOpen} transparent animationType="slide" onRequestClose={() => setExpOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setExpOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-4">Log an expense</Text>
            <Pressable
              onPress={promptScanReceipt}
              disabled={expScanning}
              className="flex-row items-center rounded-xl p-3.5 mb-4 border"
              style={{ gap: 12, borderColor: 'rgba(201,150,58,0.3)', backgroundColor: 'rgba(232,184,101,0.08)', opacity: expScanning ? 0.6 : 1 }}
            >
              <View className="items-center justify-center rounded-xl border" style={{ width: 38, height: 38, borderColor: 'rgba(201,150,58,0.3)', backgroundColor: 'rgba(232,184,101,0.12)' }}>
                {expScanning ? <ActivityIndicator color="#C9963A" size="small" /> : <Camera color="#C9963A" size={17} />}
              </View>
              <View className="flex-1">
                <Text className="text-ink font-bold text-sm">{expScanning ? 'Reading receipt…' : 'Scan a receipt'}</Text>
                <Text className="text-ink-muted text-xs mt-0.5">AI fills amount, category & date</Text>
              </View>
            </Pressable>
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
              style={{ backgroundColor: expSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
            >
              {expSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save expense</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Insurance modal */}
      <Modal visible={insOpen} transparent animationType="slide" onRequestClose={() => setInsOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setInsOpen(false)} />
          <View className="bg-surface rounded-t-3xl border-t border-[rgba(255,240,210,0.10)]" style={{ maxHeight: '85%', paddingBottom: insets.bottom + 16 }}>
            <View className="flex-row items-center justify-between px-6 pt-6 pb-3">
              <Text className="text-ink text-xl font-bold">Insurance claim</Text>
              {insurance ? (
                <Pressable onPress={() => { Alert.alert('Remove claim?', 'This deletes the insurance details for this job.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (contact) { await deleteInsurance({ id: insurance.id, contactId: contact.id }); setInsOpen(false) } } }]) }} hitSlop={8}>
                  <Trash2 color="#f5a294" size={18} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              {([
                ['claim_number', 'Claim number', 'CL-2026-04812', 'default'],
                ['carrier', 'Carrier', 'State Farm', 'default'],
                ['adjuster', 'Adjuster', 'Karen Whitfield · (615) 555-0184', 'default'],
                ['deductible', 'Deductible', '1000', 'decimal-pad'],
                ['rcv', 'RCV', '24800', 'decimal-pad'],
                ['acv', 'ACV', '18200', 'decimal-pad'],
                ['depreciation', 'Depreciation', '6600', 'decimal-pad'],
                ['supplement_amount', 'Supplement', '0', 'decimal-pad'],
                ['mortgage_company', 'Mortgage company', 'Wells Fargo (when applicable)', 'default']
              ] as const).map(([key, label, ph, kb]) => (
                <View key={key}>
                  <Text className="text-ink-muted text-[10px] font-bold tracking-[1.5px] uppercase mb-1.5">{label}</Text>
                  <TextInput
                    value={(insForm as any)[key]}
                    onChangeText={(v) => setInsForm((f) => ({ ...f, [key]: v }))}
                    keyboardType={kb as any}
                    placeholder={ph}
                    placeholderTextColor="rgba(242,237,228,0.4)"
                    className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                  />
                </View>
              ))}
              <Pressable
                onPress={saveInsurance}
                disabled={insSaving}
                className="rounded-xl py-4 items-center mt-2"
                style={{ backgroundColor: insSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
              >
                {insSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save insurance</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Quote terms modal */}
      <Modal visible={qtOpen} transparent animationType="slide" onRequestClose={() => setQtOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setQtOpen(false)} />
          <View className="bg-surface rounded-t-3xl border-t border-[rgba(255,240,210,0.10)]" style={{ maxHeight: '85%', paddingBottom: insets.bottom + 16 }}>
            <Text className="text-ink text-xl font-bold px-6 pt-6 pb-3">Quote terms</Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
              {([
                ['scope', 'Scope of work', "What you'll do, in plain English."],
                ['exclusions', 'Exclusions', "What's NOT included — prevents change-order surprises."],
                ['terms', 'Payment terms', 'Deposit, progress payments, warranty, change-order policy.']
              ] as const).map(([key, label, hint]) => (
                <View key={key}>
                  <Text className="text-ink-muted text-[10px] font-bold tracking-[1.5px] uppercase mb-1">{label}</Text>
                  <Text className="text-ink-muted text-xs mb-2">{hint}</Text>
                  <TextInput
                    value={(qtForm as any)[key]}
                    onChangeText={(v) => setQtForm((f) => ({ ...f, [key]: v }))}
                    multiline
                    placeholderTextColor="rgba(242,237,228,0.4)"
                    className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                    style={{ minHeight: 90, textAlignVertical: 'top' }}
                  />
                </View>
              ))}
              <Pressable
                onPress={saveQuoteTerms}
                disabled={qtSaving}
                className="rounded-xl py-4 items-center mt-2"
                style={{ backgroundColor: qtSaving ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
              >
                {qtSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save quote terms</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {user && contact ? (
        <>
          <PaymentSheet open={payOpen} onClose={() => setPayOpen(false)} userId={user.id} contactId={contact.id} balance={totals.balance} />
          <MarkCompleteSheet
            open={completeOpen}
            onClose={() => setCompleteOpen(false)}
            userId={user.id}
            contactId={contact.id}
            currentAmount={contact.amount}
            balance={totals.balance}
          />
        </>
      ) : null}
    </View>
  )
}

function fmtSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function QuoteTermBlock({ label, text }: { label: string; text: string }) {
  return (
    <View>
      <Text className="text-gold-bright text-[10px] font-bold tracking-[1.5px] uppercase mb-1">{label}</Text>
      <Text className="text-ink text-sm leading-5">{text}</Text>
    </View>
  )
}

function InsStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-ink text-base font-bold">{value}</Text>
      <Text className="text-ink-muted text-[10px] font-bold uppercase tracking-wider mt-0.5">{label}</Text>
    </View>
  )
}

function Stat({ label, value, tone = '#F2EDE4' }: { label: string; value: string; tone?: string }) {
  return (
    <View className="flex-1 rounded-2xl p-3.5 border border-[rgba(232,184,101,0.14)]" style={{ backgroundColor: 'rgba(24,20,17,0.6)' }}>
      <Text className="text-xl font-bold" style={{ color: tone, letterSpacing: -0.3 }} numberOfLines={1}>{value}</Text>
      <Text className="text-ink-muted text-[10px] font-bold uppercase tracking-wider mt-1">{label}</Text>
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
