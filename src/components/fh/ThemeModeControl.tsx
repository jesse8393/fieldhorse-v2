import { useId } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'
import Icon from './Icon.tsx'
import { useTheme } from '../../contexts/ThemeContext.tsx'
import type { ThemeMode } from '../../lib/themeMode.ts'
import { hapticTap } from '../../lib/haptics.ts'

// Auto, Day and Night as one three way control (spec section 10). Real
// radio inputs, so arrow keys move between the options and screen
// readers announce a group of three.
const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'auto', label: 'Auto', icon: SunMoon },
  { mode: 'day', label: 'Day', icon: Sun },
  { mode: 'night', label: 'Night', icon: Moon }
]

export default function ThemeModeControl({ label = 'Appearance' }: { label?: string }) {
  const { mode, setMode } = useTheme()
  const name = useId()
  return (
    <fieldset className="fhs-mode">
      <legend className="fhs-mode__legend">{label}</legend>
      <div className="fhs-mode__track">
        {OPTIONS.map((o) => (
          <label key={o.mode} className="fhs-mode__option">
            <input
              type="radio"
              name={name}
              value={o.mode}
              checked={mode === o.mode}
              onChange={() => { hapticTap(); setMode(o.mode) }}
            />
            <span className="fhs-mode__face">
              <Icon icon={o.icon} size={18} />
              {o.label}
            </span>
          </label>
        ))}
      </div>
      <p className="fhs-mode__hint">
        {mode === 'auto' ? 'Switches to Night at sunset where you work.' : mode === 'day' ? 'Stays light all day.' : 'Stays dark all day.'}
      </p>
    </fieldset>
  )
}
