import { useEffect } from 'react'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useTheme } from '../contexts/ThemeContext.tsx'

// Hands the company location from the profile to ThemeProvider, which
// sits above the profile provider, so Auto can follow local sunrise and
// sunset. Renders nothing.
export default function ThemeLocationSync() {
  const { profile } = useProfile()
  const { setLocation } = useTheme()
  const lat = profile?.location_lat
  const lon = profile?.location_lon
  useEffect(() => {
    setLocation(lat, lon)
  }, [lat, lon, setLocation])
  return null
}
