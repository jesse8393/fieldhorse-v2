// mobile/app/invoices.tsx — Invoices & Payments hub.
// Money-owed summary with aging buckets + an outstanding list with
// working Mark Paid / Email. Reads real fh_invoices + payments.
import { useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Send, DollarSign } from 'lucide-react-native'
import { useInvoicesOverview, useMarkInvoicePaid, type InvoiceRow } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

function full(n: number) { return `$${Math.round(n).toLocaleString()}` }
function ageLabel(inv: InvoiceRow) {
  if (inv.status === 'paid') return { txt: 'PAID', tint: theme.success }
  if (inv.ageDays > 60) return { txt: `${inv.ageDays}D · OVERDUE`, tint: theme.danger }
  if (inv.ageDays > 30) return { txt: `${inv.ageDays}D · LATE`, tint: '#C9963A' }
  return { txt: `${inv.ageDays}D · CURRENT`, tint: theme.inkMuted }
}

export default function InvoicesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading } = useInvoicesOverview(user?.id)
  const markPaid = useMarkInvoicePaid()
  const [tab, setTab] = useState<'outstanding' | 'all'>('outstanding')

  const all = data?.invoices ?? []
  const shown = tab === 'outstanding' ? all.filter((i) => i.status !== 'paid' && i.status !== 'void') : all
  const total = data?.totalOutstanding ?? 0
  const buckets = [data?.current ?? 0, data?.late ?? 0, data?.overdue ?? 0]
  const bucketMax = Math.max(1, total)

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Invoices & Payments" title="Money owed" />

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : (
          <>
            {/* Money owed card */}
            <Card glow style={{ marginTop: 18, marginBottom: 20 }}>
              <View style={{ padding: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <DollarSign color={theme.goldBright} size={14} />
                    <Text style={{ color: theme.goldBright, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>Money owed</Text>
                  </View>
                  <View style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: theme.borderGold }}>
                    <Text style={{ color: theme.goldBright, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>COLLECT · {data?.outstandingCount ?? 0}</Text>
                  </View>
                </View>
                <Text style={{ color: theme.ink, fontSize: 40, fontWeight: '800', letterSpacing: -1, marginTop: 10 }}>{full(total)}</Text>
                <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>Total outstanding</Text>

                {/* aging bar */}
                <View style={{ flexDirection: 'row', height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 16, backgroundColor: 'rgba(255,240,210,0.06)' }}>
                  <View style={{ flex: buckets[0] / bucketMax, backgroundColor: theme.inkMuted }} />
                  <View style={{ flex: buckets[1] / bucketMax, backgroundColor: '#C9963A' }} />
                  <View style={{ flex: buckets[2] / bucketMax, backgroundColor: theme.danger }} />
                  <View style={{ flex: Math.max(0.0001, 1 - (buckets[0] + buckets[1] + buckets[2]) / bucketMax) }} />
                </View>
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <Bucket label="Current · 0–30D" value={full(buckets[0])} tone={theme.ink} />
                  <Bucket label="Late · 31–60D" value={full(buckets[1])} tone="#E8B865" />
                  <Bucket label="Overdue · 60+D" value={full(buckets[2])} tone={theme.danger} />
                </View>
                <View style={{ borderTopWidth: 1, borderTopColor: theme.border, marginTop: 14, paddingTop: 12 }}>
                  <Text style={{ color: theme.inkMuted, fontSize: 13 }}>
                    <Text style={{ color: theme.success, fontWeight: '700' }}>{full(data?.collectedThisMonth ?? 0)}</Text> collected this month
                  </Text>
                </View>
              </View>
            </Card>

            {/* tabs */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' }}>Outstanding</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['outstanding', 'all'] as const).map((t) => (
                  <Pressable key={t} onPress={() => setTab(t)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: tab === t ? theme.goldBright : theme.borderMid, backgroundColor: tab === t ? `${theme.goldBright}26` : 'transparent' }}>
                    <Text style={{ color: tab === t ? theme.goldBright : theme.inkMuted, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {shown.length === 0 ? (
              <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 12 }}>{tab === 'outstanding' ? 'Nothing outstanding — all caught up.' : 'No invoices yet.'}</Text>
            ) : (
              <View style={{ gap: 12 }}>
                {shown.map((inv) => {
                  const age = ageLabel(inv)
                  const paid = inv.status === 'paid'
                  return (
                    <Card key={inv.id} accent={paid ? theme.success : '#C9963A'}>
                      <View style={{ padding: 16, paddingLeft: 18 }}>
                        <Pressable onPress={() => inv.contactId && router.push(`/jobs/${inv.contactId}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ color: theme.ink, fontSize: 17, fontWeight: '700', flex: 1 }} numberOfLines={1}>{inv.name || `Invoice #${inv.sequence ?? ''}`}</Text>
                          <Text style={{ color: theme.ink, fontSize: 18, fontWeight: '800' }}>{full(inv.amount)}</Text>
                        </Pressable>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: `${age.tint}55`, backgroundColor: `${age.tint}1f` }}>
                            <Text style={{ color: age.tint, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>{age.txt}</Text>
                          </View>
                        </View>
                        {!paid ? (
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                            {inv.email ? (
                              <Pressable onPress={() => Linking.openURL(`mailto:${inv.email}?subject=Invoice`)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: theme.borderMid }}>
                                <Send color={theme.ink} size={14} />
                                <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 13 }}>Email</Text>
                              </Pressable>
                            ) : null}
                            <Pressable onPress={() => user && markPaid({ id: inv.id, userId: user.id })} style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, backgroundColor: theme.goldBright }}>
                                <DollarSign color={theme.onGold} size={14} />
                                <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 13 }}>Mark Paid</Text>
                              </View>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    </Card>
                  )
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Bucket({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: tone, fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
      <Text style={{ color: theme.inkMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 2 }}>{label}</Text>
    </View>
  )
}
