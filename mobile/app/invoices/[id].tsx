// mobile/app/invoices/[id].tsx — per-job billing detail (the web
// InvoiceDetail). :id is a contact id. Contract / paid / balance with a
// payment history and a Collect Payment flow. PDF/email/public-link defer.
import { useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Modal } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { WebView } from 'react-native-webview'
import { DollarSign, Briefcase, Eye, Share2, Send, Link as LinkIcon, X } from 'lucide-react-native'
import { useInvoiceDetail, useProfile, useInvoiceDraws, useGenerateDraws, useUpdateInvoiceStatus } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../../components/ui'
import { PaymentSheet } from '../../components/PaymentSheet'
import { buildInvoiceHtml } from '../../lib/invoiceHtml'
import { shareProposalPdf } from '../../lib/quotePdf'
import { sendInvoiceEmail } from '../../lib/sendDocs'
import { mintPublicLink } from '../../lib/publicLink'

function money(n: number) { return `$${Math.round(n).toLocaleString()}` }

export default function InvoiceDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending } = useInvoiceDetail(id)
  const { data: profile } = useProfile(user?.id)
  const { data: draws = [] } = useInvoiceDraws(id)
  const generateDraws = useGenerateDraws()
  const updateDrawStatus = useUpdateInvoiceStatus()
  const queryClient = useQueryClient()
  const [payOpen, setPayOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [busy, setBusy] = useState<null | 'send' | 'link' | 'draws'>(null)

  if (isPending) {
    return <View style={{ flex: 1 }}><ScreenBackground /><ActivityIndicator color={theme.goldBright} style={{ marginTop: insets.top + 80 }} /></View>
  }
  if (!data) {
    return (
      <View style={{ flex: 1 }}><ScreenBackground />
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 20 }}>
          <ScreenHeader backLabel="Invoices" onBack={() => router.back()} eyebrow="Invoice" title="Not found" />
          <Text style={{ color: theme.inkMuted, marginTop: 20 }}>This invoice could not be loaded.</Text>
        </ScrollView>
      </View>
    )
  }

  const { contact, payments, amount: total, paid, balance, pctPaid, ageDays } = data
  const isClosed = (contact.stage || '').toLowerCase() === 'closed'
  const isPaid = balance < 0.5 && total > 0
  const status = isClosed ? { label: 'CLOSED', tint: theme.inkMuted }
    : isPaid ? { label: 'PAID', tint: theme.success }
    : ageDays > 60 ? { label: 'OVERDUE', tint: theme.danger }
    : { label: 'OUTSTANDING', tint: theme.goldBright }

  function buildHtml() {
    return buildInvoiceHtml((profile || {}) as any, contact as any, {
      number: String(contact.id || '').slice(0, 4).toUpperCase(),
      issuedAt: new Date(),
      jobTitle: contact.jobTitle,
      total, paid, balance,
      payments: payments.map((p: any) => ({ method: p.method, amount: p.amount, paidOn: p.paidOn, reference: p.reference }))
    })
  }
  const fileName = `Invoice_${(contact.name || 'client').replace(/\s+/g, '_')}.pdf`

  async function onShare() {
    if (sharing) return
    setSharing(true)
    try { await shareProposalPdf(buildHtml(), fileName) }
    catch (e: any) { Alert.alert("Couldn't create PDF", e?.message || 'Try again.') }
    finally { setSharing(false) }
  }
  async function onSendEmail() {
    if (busy || !user) return
    if (!(contact.email || '').trim()) { Alert.alert('Add a client email first', 'Add an email to the client, then send.'); return }
    setBusy('send')
    try {
      const res = await sendInvoiceEmail({ html: buildHtml(), filename: fileName, userId: user.id, contact: { id: contact.id, name: contact.name, email: contact.email } })
      if (res.ok) { queryClient.invalidateQueries({ queryKey: ['invoiceDetail', id] }); Alert.alert('Invoice sent', `Emailed to ${contact.email}.`) }
      else Alert.alert(res.notConfigured ? 'Saved to Files' : "Couldn't send", res.message || 'Try again.')
    } catch (e: any) { Alert.alert("Couldn't send", e?.message || 'Try again.') }
    finally { setBusy(null) }
  }
  async function onCopyLink() {
    if (busy || !user) return
    setBusy('link')
    try {
      const { url } = await mintPublicLink({ contactId: contact.id, userId: user.id, kind: 'invoice' })
      await Clipboard.setStringAsync(url)
      Alert.alert('Share link copied', 'Paste it into a text or email — the customer can view and pay online.')
    } catch (e: any) { Alert.alert("Couldn't create link", e?.message || 'Try again.') }
    finally { setBusy(null) }
  }

  const drawsIssued = draws.reduce((s: number, d: any) => s + Number(d.amount || 0), 0)
  const unbilled = Math.max(0, total - drawsIssued)
  async function onGenerateDraws() {
    if (busy || !user) return
    if (draws.length) { Alert.alert('Draws already exist', 'Delete them first to regenerate from terms.'); return }
    setBusy('draws')
    const { error } = await generateDraws({ userId: user.id, contactId: contact.id, contractTotal: total })
    setBusy(null)
    if (error) Alert.alert("Couldn't generate draws", error.message)
  }
  async function cycleDraw(d: any) {
    const next = d.status === 'draft' ? 'sent' : d.status === 'sent' ? 'paid' : 'draft'
    await updateDrawStatus({ id: d.id, contactId: contact.id, status: next })
    queryClient.invalidateQueries({ queryKey: ['invoiceDraws', id] })
  }
  const drawTint = (s: string) => s === 'paid' ? theme.success : s === 'sent' ? theme.goldBright : theme.inkMuted

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 120, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="Invoices" onBack={() => router.back()} eyebrow="Invoice" title={contact.name || 'Invoice'} />

        {/* Hero */}
        <Card glow style={{ marginTop: 16, marginBottom: 18 }}>
          <View style={{ padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: `${status.tint}55`, backgroundColor: `${status.tint}1f` }}>
                <Text style={{ color: status.tint, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>{status.label}</Text>
              </View>
              {contact.jobTitle ? <Text style={{ color: theme.inkMuted, fontSize: 13 }} numberOfLines={1}>{contact.jobTitle}</Text> : null}
            </View>
            <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 16 }}>Balance due</Text>
            <Text style={{ color: theme.ink, fontSize: 42, fontWeight: '800', letterSpacing: -1, marginTop: 2 }}>{money(balance)}</Text>
            <View style={{ height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,240,210,0.06)', marginTop: 14 }}>
              <View style={{ width: `${pctPaid}%`, height: '100%', backgroundColor: theme.success }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: theme.inkMuted, fontSize: 12 }}><Text style={{ color: theme.success, fontWeight: '700' }}>{money(paid)}</Text> paid</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 12 }}>of {money(total)} · {Math.round(pctPaid)}%</Text>
            </View>
          </View>
        </Card>

        {/* Service line */}
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Summary</Text>
        <Card style={{ marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <Text style={{ color: theme.ink, fontSize: 15, flex: 1 }} numberOfLines={2}>{contact.jobTitle || contact.name || 'Contract'}</Text>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '800' }}>{money(total)}</Text>
          </View>
        </Card>

        {/* Progress draws */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' }}>Progress draws{draws.length ? ` · ${draws.length}` : ''}</Text>
          {draws.length === 0 && total > 0 ? (
            <Pressable onPress={onGenerateDraws} disabled={busy === 'draws'}>
              {busy === 'draws' ? <ActivityIndicator color={theme.goldBright} /> : <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '700' }}>Generate 50/40/10</Text>}
            </Pressable>
          ) : null}
        </View>
        {draws.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 13, marginBottom: 18 }}>
            No draws yet. Generate a 50/40/10 schedule from the contract, or bill it all at once with Collect Payment.
          </Text>
        ) : (
          <View style={{ gap: 8, marginBottom: 8 }}>
            {draws.map((d: any) => (
              <Card key={d.id}>
                <Pressable onPress={() => cycleDraw(d)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{d.title || `Draw ${d.sequence_number}`}</Text>
                    <Text style={{ color: drawTint(d.status), fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2 }}>{d.status} · tap to change</Text>
                  </View>
                  <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '800' }}>{money(Number(d.amount || 0))}</Text>
                </Pressable>
              </Card>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 2, marginBottom: 18 }}>
              <Text style={{ color: theme.inkMuted, fontSize: 12 }}>Billed {money(drawsIssued)}</Text>
              <Text style={{ color: unbilled > 0 ? theme.goldBright : theme.inkMuted, fontSize: 12 }}>{unbilled > 0 ? `${money(unbilled)} unbilled` : 'Fully scheduled'}</Text>
            </View>
          </View>
        )}

        {/* Payments */}
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Payments{payments.length ? ` · ${payments.length}` : ''}</Text>
        {payments.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginBottom: 18 }}>No payments recorded yet.</Text>
        ) : (
          <View style={{ gap: 10, marginBottom: 18 }}>
            {payments.map((p) => (
              <Card key={p.id} accent={theme.success}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingLeft: 16 }}>
                  <View>
                    <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>{p.method || 'Payment'}</Text>
                    <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>{p.paidOn ? new Date(p.paidOn).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}{p.reference ? ` · ${p.reference}` : ''}</Text>
                  </View>
                  <Text style={{ color: theme.success, fontSize: 16, fontWeight: '800' }}>{money(p.amount)}</Text>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Open job */}
        <Pressable onPress={() => router.push(`/jobs/${contact.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: 'rgba(255,240,210,0.04)' }}>
          <Briefcase color={theme.goldBright} size={16} />
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600', flex: 1 }}>Open job</Text>
          <Text style={{ color: theme.goldBright, fontSize: 13, fontWeight: '700' }}>View</Text>
        </Pressable>
      </ScrollView>

      {/* Sticky action bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: 'rgba(11,9,7,0.92)', borderTopWidth: 1, borderTopColor: theme.border, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ActionBtn icon={<Eye color={theme.goldBright} size={15} />} label="Preview" onPress={() => setPreviewHtml(buildHtml())} outline />
          <ActionBtn icon={sharing ? <ActivityIndicator color={theme.goldBright} /> : <Share2 color={theme.goldBright} size={15} />} label="Share PDF" onPress={onShare} outline />
          <ActionBtn icon={busy === 'link' ? <ActivityIndicator color={theme.goldBright} /> : <LinkIcon color={theme.goldBright} size={15} />} label="Link" onPress={onCopyLink} outline />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {contact.email ? (
            <ActionBtn icon={busy === 'send' ? <ActivityIndicator color={theme.ink} /> : <Send color={theme.ink} size={15} />} label="Send invoice" onPress={onSendEmail} outline />
          ) : null}
          <Pressable onPress={() => setPayOpen(true)} style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, backgroundColor: theme.goldBright }}>
              <DollarSign color={theme.onGold} size={15} />
              <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14 }}>Collect Payment</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* Invoice preview */}
      <Modal visible={!!previewHtml} animationType="slide" onRequestClose={() => setPreviewHtml(null)}>
        <View style={{ flex: 1, backgroundColor: '#33302b' }}>
          <View style={{ paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1714' }}>
            <Text style={{ color: '#F2EDE4', fontWeight: '700', fontSize: 16 }}>Invoice preview</Text>
            <Pressable onPress={() => setPreviewHtml(null)} hitSlop={12}><X color="#F2EDE4" size={22} /></Pressable>
          </View>
          {previewHtml ? <WebView originWhitelist={['*']} source={{ html: previewHtml }} style={{ flex: 1, backgroundColor: '#33302b' }} scalesPageToFit /> : null}
        </View>
      </Modal>

      {user ? (
        <PaymentSheet open={payOpen} onClose={() => setPayOpen(false)} userId={user.id} contactId={contact.id} balance={balance} />
      ) : null}
    </View>
  )
}

function ActionBtn({ icon, label, onPress, outline }: { icon: React.ReactNode; label: string; onPress: () => void; outline?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 13, borderWidth: outline ? 1 : 0, borderColor: theme.borderMid, backgroundColor: outline ? 'rgba(255,240,210,0.04)' : 'transparent' }}>
      {icon}
      <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}
