// mobile/components/DailyBriefCard.tsx — AI morning brief on Home.
// On demand (to control cost/latency), sends a compact summary of today's
// business state to Claude and shows a tight prioritized brief.
import { useState } from 'react'
import { View, Text, Pressable, ActivityIndicator } from 'react-native'
import { Sparkles, RefreshCw } from 'lucide-react-native'
import { claudeMessage, claudeText } from '../lib/anthropic'
import { Card, SectionLabel, theme } from './ui'

const SYSTEM = `You are a contractor's no-nonsense assistant. Given a snapshot of today's business state, write a short morning brief: at most 3 bullet points, each one line, prioritizing the most important actions to take today. Be direct and concrete. Reference the numbers given. No greeting, no fluff, no markdown headers. Start each line with "• ".`

export function DailyBriefCard({ context }: { context: string }) {
  const [loading, setLoading] = useState(false)
  const [brief, setBrief] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function generate() {
    if (loading) return
    setLoading(true); setErr(null)
    try {
      const res = await claudeMessage({ system: SYSTEM, messages: [{ role: 'user', content: context }], maxTokens: 300 })
      const text = claudeText(res).trim()
      setBrief(text || 'No brief returned.')
    } catch (e) {
      setErr((e as Error).message || 'Could not generate a brief.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <SectionLabel>Today's brief</SectionLabel>
        {brief ? (
          <Pressable onPress={generate} hitSlop={8} disabled={loading} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <RefreshCw color={theme.goldBright} size={12} />
            <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '700' }}>Refresh</Text>
          </Pressable>
        ) : null}
      </View>
      <Card glow style={{ marginBottom: 24 }}>
        <View style={{ padding: 16 }}>
          {brief ? (
            <Text style={{ color: theme.ink, fontSize: 14, lineHeight: 22 }}>{brief}</Text>
          ) : (
            <Pressable onPress={generate} disabled={loading} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.goldBright}1f`, borderWidth: 1, borderColor: theme.borderGold }}>
                {loading ? <ActivityIndicator color={theme.goldBright} size="small" /> : <Sparkles color={theme.goldBright} size={18} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700' }}>{loading ? 'Thinking…' : 'Get your morning brief'}</Text>
                <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }}>AI summary of what matters today</Text>
              </View>
            </Pressable>
          )}
          {err ? <Text style={{ color: theme.danger, fontSize: 12, marginTop: 10 }}>{err}</Text> : null}
        </View>
      </Card>
    </>
  )
}
