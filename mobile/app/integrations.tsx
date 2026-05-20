// mobile/app/integrations.tsx — Integrations hub.
// Pushed from More. Lists each third-party provider with its connection
// status from fh_integrations. Connecting launches the provider's OAuth
// edge function once it's live; until then it explains what's still
// needed. Disconnect flips the row status.
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, Plug, Check } from 'lucide-react-native'
import {
  PROVIDERS, useIntegrations, useDisconnectIntegration, oauthStartUrl,
  type IntegrationRow, type ProviderMeta
} from '../lib/integrations'
import { useAuth } from '../contexts/AuthContext'

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
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#E8B865" size={20} />
          <Text className="text-gold-bright font-bold">More</Text>
        </Pressable>

        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Integrations</Text>
        <Text className="text-ink text-3xl font-bold mb-2">Connect your tools</Text>
        <Text className="text-ink-muted text-sm mb-6">Link FieldHorse to the apps you already run your business on.</Text>

        {isLoading ? (
          <ActivityIndicator color="#E8B865" />
        ) : (
          <View style={{ gap: 10 }}>
            {PROVIDERS.map((p) => {
              const row = byProvider.get(p.id)
              const status = row?.status ?? 'disconnected'
              const connected = status === 'connected'
              const tint = STATUS_TINT[status] ?? '#5C5C5C'
              return (
                <View key={p.id} className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)]">
                  <View className="flex-row items-center" style={{ gap: 10 }}>
                    <View
                      className="rounded-xl items-center justify-center"
                      style={{ width: 40, height: 40, backgroundColor: '#1B1816', borderWidth: 1, borderColor: 'rgba(232,184,101,0.22)' }}
                    >
                      <Plug color="#E8B865" size={18} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-ink text-base font-bold">{p.name}</Text>
                      <Text className="text-ink-muted text-xs mt-0.5">{p.blurb}</Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-[9px] font-bold uppercase tracking-wider" style={{ color: tint }}>
                        {connected ? 'Connected' : status === 'disconnected' ? 'Not connected' : status}
                      </Text>
                    </View>
                  </View>

                  {connected && row?.display_name ? (
                    <View className="flex-row items-center mt-2" style={{ gap: 6 }}>
                      <Check color="#4F8C5E" size={13} />
                      <Text className="text-ink-muted text-xs">{row.display_name}</Text>
                    </View>
                  ) : null}
                  {status === 'error' && row?.last_error ? (
                    <Text className="text-[#f5a294] text-xs mt-2">{row.last_error}</Text>
                  ) : null}

                  <View className="flex-row mt-3" style={{ gap: 8 }}>
                    {connected ? (
                      <Pressable
                        onPress={() => onDisconnect(p)}
                        className="flex-1 rounded-xl py-2.5 items-center border border-[rgba(232,90,87,0.3)]"
                        style={{ backgroundColor: 'rgba(232,90,87,0.10)' }}
                      >
                        <Text className="text-[#f5a294] font-bold text-sm">Disconnect</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => onConnect(p)}
                        className="flex-1 rounded-xl py-2.5 items-center"
                        style={{ backgroundColor: p.live ? '#E8B865' : 'rgba(232,184,101,0.18)' }}
                      >
                        <Text className="font-bold text-sm" style={{ color: p.live ? '#1A120A' : '#E8B865' }}>
                          {p.live ? 'Connect' : 'Setup required'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )
            })}
          </View>
        )}

        <Text className="text-ink-muted text-[11px] text-center mt-6 leading-4">
          Connections are secured server-side — your tokens never touch the app.
        </Text>
      </ScrollView>
    </View>
  )
}
