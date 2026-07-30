/** @type {import('tailwindcss').Config} */
// NativeWind mirrors the canonical web tokens in src/styles/tokens.css.
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    spacing: {
      0: '0px',
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '24px',
      6: '32px',
      7: '48px'
    },
    borderRadius: {
      DEFAULT: '10px',
      sm: '10px',
      md: '10px',
      lg: '10px',
      xl: '10px',
      full: '999px'
    },
    fontSize: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '20px',
      xl: '24px'
    },
    extend: {
      colors: {
        bg: '#141414',
        surface: '#141414',
        'surface-2': '#141414',
        ink: '#F2EDE4',
        'ink-muted': '#5C5C5C',
        gold: '#C9963A',
        'gold-bright': '#C9963A',
        good: '#2D7A4F',
        danger: '#C0392B'
      },
      fontFamily: {
        body: ['DM Sans'],
        display: ['Bebas Neue']
      }
    }
  },
  plugins: []
}
