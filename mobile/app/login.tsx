// mobile/app/login.tsx — email/password sign-in.
//
// Native equivalent of the web Login screen. On success the auth state
// change fires and the root layout's redirect gate moves the user into
// the (tabs) group. Uses the same Supabase project as web, so the same
// credentials work.
import { useState } from 'react'
import {
  View, Text, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../contexts/AuthContext'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const { signIn, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleForgot() {
    setError(''); setNotice('')
    if (!email.trim()) { setError('Enter your email first, then tap reset.'); return }
    setBusy(true)
    const { error: err } = await resetPassword(email.trim())
    setBusy(false)
    if (err) setError(err.message || 'Could not send reset email.')
    else setNotice('Check your email for a password reset link.')
  }

  async function handleSignIn() {
    if (busy) return
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await signIn(email.trim(), password)
    setBusy(false)
    if (err) setError(err.message || 'Sign in failed.')
    // On success the redirect gate in _layout.tsx takes over.
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-bg"
    >
      <View
        className="flex-1 justify-center px-7"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <Text className="text-gold-bright text-[11px] font-bold tracking-[2px] uppercase mb-2">
          FieldHorse
        </Text>
        <Text className="text-ink text-4xl font-bold mb-1">Welcome back</Text>
        <Text className="text-ink-muted text-sm mb-8">Sign in to your jobsite command center.</Text>

        <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@company.com"
          placeholderTextColor="rgba(242,237,228,0.4)"
          className="bg-surface border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
        />

        <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          placeholder="••••••••"
          placeholderTextColor="rgba(242,237,228,0.4)"
          onSubmitEditing={handleSignIn}
          className="bg-surface border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
        />

        {error ? <Text className="text-[#f5a294] text-sm mb-4">{error}</Text> : null}
        {notice ? <Text className="text-[#7fc99a] text-sm mb-4">{notice}</Text> : null}

        <Pressable
          onPress={handleSignIn}
          disabled={busy}
          className="rounded-xl py-4 items-center"
          style={{ backgroundColor: busy ? 'rgba(232,184,101,0.5)' : '#C9963A' }}
        >
          {busy
            ? <ActivityIndicator color="#1A120A" />
            : <Text className="text-[#1A120A] text-base font-bold">Sign in</Text>}
        </Pressable>

        <Pressable onPress={handleForgot} disabled={busy} className="items-center mt-5" hitSlop={8}>
          <Text className="text-ink-muted text-sm">Forgot password?</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
