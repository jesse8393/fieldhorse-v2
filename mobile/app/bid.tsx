// mobile/app/bid.tsx — AI estimate generator.
//
// Native port of the web Bid screen. Takes a scope + job type + trades,
// asks Claude for a structured estimate (line items + ranges), applies a
// margin, and can spin up a stage='quote' job with quote items via
// useCreateJobFromBid. Rate card is the seed default (web pulls user
// overrides too; mobile keeps the seed for now).
import { useMemo, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Sparkles, Check } from 'lucide-react-native'
import { ScreenBackground, ScreenHeader, GoldButton, theme } from '../components/ui'
import { claudeMessage, claudeText } from '../lib/anthropic'
import { useCreateJobFromBid, type BidResult } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'

const RATE_CARD: Record<string, { unit: string; low: number; high: number; label: string }> = {
  concrete: { unit: 'sqft', low: 8, high: 12, label: 'Concrete' },
  framing: { unit: 'lf', low: 4, high: 7, label: 'Framing' },
  drywall: { unit: 'sqft', low: 2.5, high: 4, label: 'Drywall' },
  demo: { unit: 'sqft', low: 3, high: 6, label: 'Demo' },
  roofing: { unit: 'sqft', low: 5, high: 9, label: 'Roofing' },
  electrical: { unit: 'point', low: 150, high: 250, label: 'Electrical' },
  plumbingRough: { unit: 'lump', low: 800, high: 1500, label: 'Plumbing rough' },
  insulation: { unit: 'sqft', low: 1.5, high: 3, label: 'Insulation' },
  lvpFlooring: { unit: 'sqft', low: 4, high: 7, label: 'LVP flooring' },
  paint: { unit: 'sqft', low: 1.5, high: 3, label: 'Paint' },
  permits: { unit: 'lump', low: 200, high: 800, label: 'Permits' },
  outdoorLiving: { unit: 'sqft', low: 25, high: 65, label: 'Outdoor living' }
}

const JOB_TYPES = ['New Build', 'Renovation', 'Addition', 'Kitchen', 'Bath', 'Concrete', 'Outdoor Living', 'Insurance', 'Roofing']

const SYSTEM = `You are an estimating assistant for a contractor's business. Given a scope description, return JSON with: summary (short title string), line_items (array of {name, qty, unit, rate_low, rate_high, notes}), total_low, total_high, contingency_pct, assumptions (array), risks (array). Use rates from the provided rate card when possible. Tailor line items to the job_type category provided. Never mention any platform, app, or tool by name in your output. Return ONLY JSON.`

function money(n: number) { return `$${Math.round(Number(n || 0)).toLocaleString()}` }

export default function BidScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const createJob = useCreateJobFromBid()

  const [scope, setScope] = useState('')
  const [jobType, setJobType] = useState('')
  const [picks, setPicks] = useState<string[]>([])
  const [marginPct, setMarginPct] = useState(25)
  const [generating, setGenerating] = useState(false)
  const [bid, setBid] = useState<BidResult | null>(null)
  const [err, setErr] = useState('')
  const [pushing, setPushing] = useState(false)

  const total = useMemo(() => {
    if (!bid) return null
    const low = bid.total_low || (bid.line_items || []).reduce((s, li) => s + Number(li.rate_low || 0) * Number(li.qty || 1), 0)
    const high = bid.total_high || (bid.line_items || []).reduce((s, li) => s + Number(li.rate_high || 0) * Number(li.qty || 1), 0)
    const midpoint = (low + high) / 2
    const withMargin = midpoint / (1 - marginPct / 100)
    return { low, high, midpoint, withMargin }
  }, [bid, marginPct])

  function togglePick(k: string) {
    setPicks((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  }

  async function generate() {
    if (!scope.trim() || generating) return
    setGenerating(true); setErr(''); setBid(null)
    try {
      const rateText = Object.keys(RATE_CARD)
        .map((k) => `${k}: $${RATE_CARD[k].low}–$${RATE_CARD[k].high} per ${RATE_CARD[k].unit}`)
        .join('; ')
      const res = await claudeMessage({
        system: `${SYSTEM}\n\nRate card: ${rateText}`,
        messages: [{ role: 'user', content: `Job type: ${jobType || 'unspecified'}\nScope: ${scope}\nPre-checked trades: ${picks.join(', ') || 'none'}` }],
        maxTokens: 1400
      })
      const text = claudeText(res)
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) { setErr('The estimator returned no structured result. Try rephrasing the scope.'); return }
      setBid(JSON.parse(match[0]) as BidResult)
    } catch (e: any) {
      setErr(e?.message || 'Estimate generation failed.')
    } finally {
      setGenerating(false)
    }
  }

  async function pushToJob() {
    if (!bid || !total || !user || pushing) return
    setPushing(true)
    const { error, id } = await createJob({
      userId: user.id, bid, jobType, scope,
      recommendedPrice: Math.round(total.withMargin),
      section: picks[0] ? RATE_CARD[picks[0]]?.label : 'Scope'
    })
    setPushing(false)
    if (error || !id) { Alert.alert("Couldn't create job", error?.message || 'Try again.'); return }
    router.replace(`/jobs/${id}`)
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader backLabel="Back" onBack={() => router.back()} eyebrow="Estimator" title="AI estimate" />
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6, marginBottom: 20 }}>Describe the job — get a line-item estimate you can refine and send.</Text>

        <Text style={lbl}>Scope of work</Text>
        <TextInput
          value={scope}
          onChangeText={setScope}
          multiline
          placeholder="e.g. Demo and replace a 480 sf composite deck, re-frame as needed, install code-compliant flashing and Trex decking."
          placeholderTextColor="rgba(242,237,228,0.4)"
          style={[input, { minHeight: 100, textAlignVertical: 'top' }]}
        />

        <Text style={[lbl, { marginTop: 18 }]}>Job type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {JOB_TYPES.map((t) => {
            const on = jobType === t
            return (
              <Pressable key={t} onPress={() => setJobType(on ? '' : t)} style={[chip, on && chipOn]}>
                <Text style={{ color: on ? theme.goldBright : theme.ink, fontSize: 13, fontWeight: '700' }}>{t}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={[lbl, { marginTop: 18 }]}>Trades involved</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.keys(RATE_CARD).map((k) => {
            const on = picks.includes(k)
            return (
              <Pressable key={k} onPress={() => togglePick(k)} style={[chip, on && chipOn, { flexDirection: 'row', gap: 5, alignItems: 'center' }]}>
                {on ? <Check color={theme.goldBright} size={12} strokeWidth={3} /> : null}
                <Text style={{ color: on ? theme.goldBright : theme.ink, fontSize: 13, fontWeight: '700' }}>{RATE_CARD[k].label}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={[lbl, { marginTop: 18 }]}>Margin · {marginPct}%</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[15, 20, 25, 30, 35].map((m) => {
            const on = marginPct === m
            return (
              <Pressable key={m} onPress={() => setMarginPct(m)} style={[chip, on && chipOn, { flex: 1, alignItems: 'center' }]}>
                <Text style={{ color: on ? theme.goldBright : theme.ink, fontSize: 13, fontWeight: '700' }}>{m}%</Text>
              </Pressable>
            )
          })}
        </View>

        {err ? <Text style={{ color: theme.danger, fontSize: 14, marginTop: 16 }}>{err}</Text> : null}

        <View style={{ marginTop: 20 }}>
          <GoldButton label="Generate estimate" onPress={generate} loading={generating} icon={<Sparkles color={theme.onGold} size={16} />} />
        </View>

        {bid && total ? (
          <View style={{ marginTop: 26 }}>
            <View style={{ backgroundColor: theme.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: theme.borderGold }}>
              <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>Recommended price</Text>
              <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', marginTop: 4 }}>{money(total.withMargin)}</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 13, marginTop: 4 }}>Range {money(total.low)} – {money(total.high)} · {marginPct}% margin</Text>
            </View>

            {(bid.line_items || []).length > 0 ? (
              <View style={{ marginTop: 16, gap: 8 }}>
                {(bid.line_items || []).map((li, i) => {
                  const qty = Number(li.qty || 1)
                  const amt = qty * Number(li.rate_high ?? li.rate_low ?? 0)
                  return (
                    <View key={i} style={{ backgroundColor: 'rgba(24,20,17,0.6)', borderRadius: 14, padding: 13, borderWidth: 1, borderColor: theme.borderMid, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600' }}>{li.name}</Text>
                        <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>{qty} {li.unit || ''} · {money(li.rate_low || 0)}–{money(li.rate_high || 0)}{li.notes ? ` · ${li.notes}` : ''}</Text>
                      </View>
                      <Text style={{ color: theme.ink, fontWeight: '700' }}>{money(amt)}</Text>
                    </View>
                  )
                })}
              </View>
            ) : null}

            {bid.assumptions?.length ? <Bullets title="Assumptions" items={bid.assumptions} /> : null}
            {bid.risks?.length ? <Bullets title="Risks" items={bid.risks} /> : null}

            <View style={{ marginTop: 18 }}>
              <GoldButton label="Create job from estimate" onPress={pushToJob} loading={pushing} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={lbl}>{title}</Text>
      {items.map((it, i) => (
        <Text key={i} style={{ color: theme.inkMuted, fontSize: 13, lineHeight: 19, marginBottom: 2 }}>• {it}</Text>
      ))}
    </View>
  )
}

const lbl = { color: theme.inkMuted, fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8 }
const input = { backgroundColor: theme.surface, borderWidth: 1, borderColor: 'rgba(255,240,210,0.12)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: theme.ink }
const chip = { backgroundColor: 'rgba(24,20,17,0.6)', borderWidth: 1, borderColor: theme.borderMid, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }
const chipOn = { borderColor: theme.goldBright, backgroundColor: 'rgba(232,184,101,0.14)' }
