/** @type {import('tailwindcss').Config} */
// NativeWind Tailwind config. Mirrors the web app's warm-onyx + gold
// palette (src/styles/tokens.css) so the native UI matches FieldHorse's
// brand without re-deriving it.
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#0B0907',
        surface: '#141110',
        'surface-2': '#1C1814',
        ink: '#F2EDE4',
        'ink-muted': 'rgba(242,237,228,0.55)',
        gold: '#C9963A',
        'gold-bright': '#E8B865',
        good: '#4F8C5E',
        danger: '#D26A6A'
      },
      fontFamily: {
        body: ['System'],
        display: ['System']
      }
    }
  },
  plugins: []
}
