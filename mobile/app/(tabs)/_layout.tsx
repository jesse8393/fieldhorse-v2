// mobile/app/(tabs)/_layout.tsx — the 5-tab bottom nav, mirroring the
// web BottomNav (Home / Jobs / Clients / Schedule / More) with the
// gold-on-onyx brand. expo-router Tabs gives a native tab bar with
// real safe-area + haptics, replacing the web's fixed-position nav.
import { Tabs } from 'expo-router'
import { Home, Briefcase, Users, Calendar, MoreHorizontal } from 'lucide-react-native'

const GOLD = '#C9963A'
const MUTED = 'rgba(242,237,228,0.55)'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: '#100E0C',
          borderTopColor: 'rgba(255,240,210,0.06)'
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="jobs"
        options={{ title: 'Jobs', tabBarIcon: ({ color, size }) => <Briefcase color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="clients"
        options={{ title: 'Clients', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="schedule"
        options={{ title: 'Schedule', tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color, size }) => <MoreHorizontal color={color} size={size} /> }}
      />
    </Tabs>
  )
}
