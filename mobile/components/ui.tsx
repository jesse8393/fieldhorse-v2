// mobile/components/ui.tsx — premium design-system primitives.
//
// Ports the web app's "v3" visual language to React Native: layered
// surfaces with a top inset-highlight, soft depth shadows, a faint gold
// aurora on the screen background, gold-gradient CTAs, and refined pills.
// RN has no CSS gradients/insets, so we compose them with
// expo-linear-gradient + layered shadows.
import { ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, type ViewStyle, type StyleProp } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

export const theme = {
  bg: '#0B0907',
  page: '#100E0C',
  surface: '#141110',
  surface2: '#1C1814',
  ink: '#F2EDE4',
  inkMuted: 'rgba(242,237,228,0.55)',
  inkFaint: 'rgba(242,237,228,0.40)',
  gold: '#C9963A',
  goldBright: '#E8B865',
  goldHot: '#E4BE6F',
  goldDeep: '#8C6F30',
  onGold: '#1A1208',
  border: 'rgba(255,240,210,0.06)',
  borderMid: 'rgba(255,240,210,0.10)',
  borderGold: 'rgba(201,150,58,0.30)',
  success: '#5BB97A',
  danger: '#f5a294'
}

export const STAGE_TINT: Record<string, string> = {
  lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E',
  invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f'
}

const GOLD_BTN = ['#F0CE86', '#E4BE6F', '#C9963A'] as const
const SURFACE_GRAD = ['#1E1916', '#151210', '#0F0D0B'] as const
const GOLD_SURFACE_GRAD = ['#241D12', '#191410', '#120F0C'] as const

const shadow = StyleSheet.create({
  card: {
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 }, elevation: 8
  },
  glow: {
    shadowColor: '#E8B865', shadowOpacity: 0.40, shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 }, elevation: 12
  }
})

// Full-screen backdrop: deep base + a faint gold aurora band at the top.
export function ScreenBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]} />
      <LinearGradient
        colors={['rgba(232,176,76,0.13)', 'rgba(232,176,76,0.03)', 'rgba(11,9,7,0)']}
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
    <View style={[shadow.card, glow && shadow.glow, { borderRadius: 18 }, style]}>
      <LinearGradient
        colors={glow ? GOLD_SURFACE_GRAD : SURFACE_GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          borderRadius: 18, overflow: 'hidden',
          borderWidth: 1, borderColor: glow ? theme.borderGold : theme.border
        }}
      >
        {/* top inset highlight */}
        <LinearGradient
          colors={['transparent', glow ? 'rgba(255,222,150,0.22)' : 'rgba(255,240,210,0.12)', 'transparent']}
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
    <Pressable onPress={onPress} disabled={disabled || loading} style={[shadow.glow, { borderRadius: 14 }, style, (disabled || loading) && { opacity: 0.6 }]}>
      <LinearGradient
        colors={GOLD_BTN}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
      >
        {icon}
        <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 15, letterSpacing: 0.2 }}>{label}</Text>
      </LinearGradient>
    </Pressable>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={{ color: theme.goldBright, fontSize: 11, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' }}>{children}</Text>
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Text style={[{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' }, style as object]}>{children}</Text>
}

export function StagePill({ stage }: { stage: string }) {
  const tint = STAGE_TINT[stage] ?? '#5C5C5C'
  return (
    <View style={{ alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${tint}22`, borderWidth: 1, borderColor: `${tint}55` }}>
      <Text style={{ color: tint, fontSize: 9, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>{stage}</Text>
    </View>
  )
}
