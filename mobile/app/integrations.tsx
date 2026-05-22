// mobile/app/integrations.tsx — Integrations hub.
// Pushed from More. Lists each third-party provider with its connection
// status from fh_integrations. Connecting launches the provider's OAuth
// edge function once it's live; until then it explains what's still
// needed. Disconnect flips the row status.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Plug, Check } from 'lucide-react-native'
import {
  PROVIDERS, useIntegrations, useDisconnectIntegration, oauthStartUrl,
  type IntegrationRow, type ProviderMeta
} from '../lib/integrations'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, GoldButton, theme } from '../components/ui'

const STATUS_TINT: Record<string, string> = {
  connected: '#4F8C5E', error: '#7d2a1f', expired: '#C9963A', disconnected: '#5C5C5C'
}

export default function IntegrationsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: rows = [], isLoading } = useIntegrations(user?.id)
  const disconnect = useDisconnectIntegration()

  const byProvider = new Map<string, IntegrationRow>()
  for (const r of rows) byProvider.set(r.provider, r)

  function onConnect(p: ProviderMeta) {
    if (!p.live) {
      Alert.alert(
        `${p.name} — setup pending`,
        `The backend for this integration isn't connected yet.\n\n${p.setupNote || ''}`,
        [{ text: 'OK' }]
      )
      return
    }
    Linking.openURL(oauthStartUrl(p.id))
  }

  function onDisconnect(p: ProviderMeta) {
    if (!user) return
    Alert.alert(`Disconnect ${p.name}?`, 'You can reconnect at any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => disconnect({ userId: user.id, provider: p.id }) }
    ])
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Integrations" title="Connect your tools" />
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6, marginBottom: 22 }}>Link FieldHorse to the apps you already run your business on.</Text>

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} />
        ) : (
          <View style={{ gap: 12 }}>
            {PROVIDERS.map((p) => {
              const row = byProvider.get(p.id)
              const status = row?.status ?? 'disconnected'
              const connected = status === 'connected'
              const tint = STATUS_TINT[status] ?? '#5C5C5C'
              return (
                <Card key={p.id} glow={connected}>
                  <View style={{ padding: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: 'rgba(232,184,101,0.22)' }}>
                        <Plug color={theme.goldBright} size={18} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }}>{p.name}</Text>
                        <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>{p.blurb}</Text>
                      </View>
                      <Text style={{ color: tint, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        {connected ? 'Connected' : status === 'disconnected' ? 'Not connected' : status}
                      </Text>
                    </View>

                    {connected && row?.display_name ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                        <Check color={theme.success} size={13} />
                        <Text style={{ color: theme.inkMuted, fontSize: 12 }}>{row.display_name}</Text>
                      </View>
                    ) : null}
                    {status === 'error' && row?.last_error ? (
                      <Text style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{row.last_error}</Text>
                    ) : null}

                    <View style={{ marginTop: 14 }}>
                      {connected ? (
                        <Pressable onPress={() => onDisconnect(p)} style={{ borderRadius: 12, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(232,90,87,0.3)', backgroundColor: 'rgba(232,90,87,0.10)' }}>
                          <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 14 }}>Disconnect</Text>
                        </Pressable>
                      ) : p.live ? (
                        <GoldButton label="Connect" onPress={() => onConnect(p)} />
                      ) : (
                        <Pressable onPress={() => onConnect(p)} style={{ borderRadius: 12, paddingVertical: 11, alignItems: 'center', backgroundColor: 'rgba(232,184,101,0.16)', borderWidth: 1, borderColor: theme.borderGold }}>
                          <Text style={{ color: theme.goldBright, fontWeight: '700', fontSize: 14 }}>Setup required</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </Card>
              )
            })}
          </View>
        )}

        <Text style={{ color: theme.inkMuted, fontSize: 11, textAlign: 'center', marginTop: 24, lineHeight: 16 }}>
          Connections are secured server-side — your tokens never touch the app.
        </Text>
      </ScrollView>
    </View>
  )
}
