// mobile/app/reset-password.tsx, set a new password.
//
// Native equivalent of the web ResetPassword screen. Reached from
// Settings ("Change password") or after following a recovery link while
// signed in. Calls supabase.auth.updateUser via AuthContext.updatePassword.
import { useState } from 'react'
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ScreenBackground, ScreenHeader, GoldButton, theme } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit() {
    setError(''); setNotice('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    const { error: err } = await updatePassword(password)
    setBusy(false)
    if (err) { setError(err.message || 'Could not update password.'); return }
    setNotice('Password updated.')
    setPassword(''); setConfirm('')
    setTimeout(() => router.back(), 1000)
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
          <ScreenHeader backLabel="Settings" onBack={() => router.back()} eyebrow="Account" title="Change password" />
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6, marginBottom: 22 }}>Choose a new password for your account.</Text>

          <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>New password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            placeholder="••••••••"
            placeholderTextColor="rgba(242,237,228,0.4)"
            style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: 'rgba(242, 237, 228,0.12)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: theme.ink, marginBottom: 18 }}
          />

          <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Confirm password</Text>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            placeholder="••••••••"
            placeholderTextColor="rgba(242,237,228,0.4)"
            onSubmitEditing={submit}
            style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: 'rgba(242, 237, 228,0.12)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: theme.ink, marginBottom: 18 }}
          />

          {error ? <Text style={{ color: '#C9963A', fontSize: 14, marginBottom: 16 }}>{error}</Text> : null}
          {notice ? <Text style={{ color: '#5C5C5C', fontSize: 14, marginBottom: 16 }}>{notice}</Text> : null}

          <GoldButton label="Update password" onPress={submit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
