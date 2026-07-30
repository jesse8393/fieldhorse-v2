// mobile/components/ui.tsx, premium design-system primitives.
//
// Ports the web app's "v3" visual language to React Native: layered
// surfaces with a top inset-highlight, soft depth shadows, a faint gold
// aurora on the screen background, gold-gradient CTAs, and refined pills.
// RN has no CSS gradients/insets, so we compose them with
// expo-linear-gradient + layered shadows.
import { ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, KeyboardAvoidingView, Platform, type ViewStyle, type StyleProp } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { ChevronLeft, X } from 'lucide-react-native'

export const theme = {
  bg: '#141414',
  page: '#141414',
  surface: '#141414',
  surface2: '#141414',
  ink: '#F2EDE4',
  inkMuted: 'rgba(242,237,228,0.55)',
  inkFaint: 'rgba(242,237,228,0.40)',
  gold: '#C9963A',
  goldBright: '#C9963A',
  goldHot: '#C9963A',
  goldDeep: '#5C5C5C',
  onGold: '#141414',
  border: 'rgba(242, 237, 228,0.06)',
  borderMid: 'rgba(242, 237, 228,0.10)',
  borderGold: 'rgba(201,150,58,0.30)',
  success: '#2D7A4F',
  danger: '#C9963A'
}

export const STAGE_TINT: Record<string, string> = {
  lead: '#5C5C5C', quote: '#C9963A', job: '#2D7A4F',
  invoice: '#C9963A', closed: '#5C5C5C', lost: '#C0392B'
}

const GOLD_BTN = ['#F2EDE4', '#C9963A', '#C9963A'] as const
const SURFACE_GRAD = ['#141414', '#141414', '#141414'] as const
const GOLD_SURFACE_GRAD = ['#141414', '#141414', '#141414'] as const

const shadow = StyleSheet.create({
  card: {
    shadowColor: '#141414', shadowOpacity: 0.45, shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 }, elevation: 8
  },
  glow: {
    shadowColor: '#C9963A', shadowOpacity: 0.40, shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 }, elevation: 12
  }
})

// Full-screen backdrop: deep base + a faint gold aurora band at the top.
export function ScreenBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]} />
      <LinearGradient
        colors={['rgba(201, 150, 58,0.13)', 'rgba(201, 150, 58,0.03)', 'rgba(20, 20, 20,0)']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }}
      />
    </View>
  )
}

// Premium card: gradient surface, top hairline highlight, depth shadow,
// optional left accent bar and gold glow.
export function Card({
  children, glow, accent, style
}: { children: ReactNode; glow?: boolean; accent?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[shadow.card, glow && shadow.glow, { borderRadius: 10 }, style]}>
      <LinearGradient
        colors={glow ? GOLD_SURFACE_GRAD : SURFACE_GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          borderRadius: 10, overflow: 'hidden',
          borderWidth: 1, borderColor: glow ? theme.borderGold : theme.border
        }}
      >
        {/* top inset highlight */}
        <LinearGradient
          colors={['transparent', glow ? 'rgba(242, 237, 228,0.22)' : 'rgba(242, 237, 228,0.12)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1 }}
        />
        {accent ? (
          <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: accent }} />
        ) : null}
        {children}
      </LinearGradient>
    </View>
  )
}

// Gold gradient CTA.
export function GoldButton({
  label, onPress, disabled, loading, icon, style
}: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; icon?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={[shadow.glow, { borderRadius: 10 }, style, (disabled || loading) && { opacity: 0.6 }]}>
      <LinearGradient
        colors={GOLD_BTN}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 10, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
      >
        {icon}
        <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14, letterSpacing: 0 }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  )
}

// Back link + eyebrow + big title, used across the detail screens.
export function ScreenHeader({ backLabel, onBack, eyebrow, title, right }: {
  backLabel: string; onBack: () => void; eyebrow: string; title: string; right?: ReactNode
}) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} hitSlop={10}>
          <ChevronLeft color={theme.goldBright} size={20} />
          <Text style={{ color: theme.goldBright, fontWeight: '700' }}>{backLabel}</Text>
        </Pressable>
        {right ?? null}
      </View>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text style={{ color: theme.ink, fontSize: 24, fontWeight: '800', letterSpacing: 0, marginTop: 2 }} numberOfLines={2}>{title}</Text>
    </>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>{children}</Text>
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }, style as object]}>{children}</Text>
}

// Reusable gesture-less bottom sheet. Slide-up Modal with a grabber, a
// title row with a close button, and a scrollable body. Every "sheet"
// flow (new lead, new client, payment, etc.) is this shell + content.
export function BottomSheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: theme.borderMid, maxHeight: '92%', paddingBottom: insets.bottom + 12 }}>
          <View style={{ alignItems: 'center', paddingTop: 12 }}>
            <View style={{ width: 40, height: 4, borderRadius: 10, backgroundColor: theme.borderMid }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800' }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
              <X color={theme.inkMuted} size={16} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// Labeled text input for sheets/forms.
export function SheetField({ label, value, onChange, ...rest }: {
  label: string; value: string; onChange: (v: string) => void
} & Record<string, unknown>) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={theme.inkFaint}
        style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: theme.ink, fontSize: 14 }}
        {...(rest as object)}
      />
    </View>
  )
}

// Footer action row for sheets (Cancel + primary).
export function SheetActions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>{children}</View>
}

export function StagePill({ stage }: { stage: string }) {
  const tint = STAGE_TINT[stage] ?? '#5C5C5C'
  return (
    <View style={{ alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: `${tint}22`, borderWidth: 1, borderColor: `${tint}55` }}>
      <Text style={{ color: tint, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>{stage}</Text>
    </View>
  )
}
