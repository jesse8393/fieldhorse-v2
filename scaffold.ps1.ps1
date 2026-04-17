# Fieldhorse v2 scaffold — overwrites default Vite template at Desktop\fieldhorse-v2
# Run from any PowerShell window (normal, not admin).

$root = "$HOME\Desktop\fieldhorse-v2"
if (-not (Test-Path $root)) {
  Write-Error "Not found: $root"
  exit 1
}

Set-Location $root

# Clean default Vite leftovers
Remove-Item -Force -ErrorAction SilentlyContinue `
  "src\App.css", "src\index.css"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "src\assets"

# Ensure dirs
$dirs = @(
  "src\components", "src\contexts", "src\lib",
  "src\screens", "src\styles", "public"
)
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
}

function Write-File($path, $content) {
  $full = Join-Path $root $path
  $dir = Split-Path $full -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($full, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "wrote $path"
}

# ---------- index.html ----------
Write-File "index.html" @'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no" />
    <meta name="theme-color" content="#141414" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Fieldhorse" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <title>Fieldhorse</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
'@

# ---------- vite.config.js ----------
Write-File "vite.config.js" @'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Fieldhorse',
        short_name: 'Fieldhorse',
        description: 'Contractor field operations',
        theme_color: '#141414',
        background_color: '#F2EDE4',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  server: { port: 5173, host: true }
})
'@

# ---------- netlify.toml ----------
Write-File "netlify.toml" @'
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
'@

# ---------- .env.example ----------
Write-File ".env.example" @'
VITE_SUPABASE_URL=https://pnmhblvslftdzfcdezbw.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_ANTHROPIC_MODEL=claude-sonnet-4-20250514
'@

# ---------- public/favicon.svg ----------
Write-File "public\favicon.svg" @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#141414"/>
  <text x="32" y="44" text-anchor="middle" font-family="Bebas Neue, Helvetica, sans-serif" font-size="36" fill="#C9963A">F</text>
</svg>
'@

# ---------- src/main.jsx ----------
Write-File "src\main.jsx" @'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import './styles/tokens.css'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
'@

# ---------- src/App.jsx ----------
Write-File "src\App.jsx" @'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.jsx'
import Home from './screens/Home.jsx'
import Login from './screens/Login.jsx'
import Onboarding from './screens/Onboarding.jsx'

function RequireAuth({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
'@

# ---------- src/styles/tokens.css ----------
Write-File "src\styles\tokens.css" @'
:root {
  --field-gold: #C9963A;
  --onyx: #141414;
  --raw-linen: #F2EDE4;
  --alert-red: #C0392B;
  --signal-green: #2D7A4F;

  --surface-0: var(--raw-linen);
  --surface-1: #ffffff;
  --surface-2: #EFE9DE;
  --ink-strong: var(--onyx);
  --ink-muted: #6B6A66;
  --ink-inverse: #FAF7F1;
  --rule: rgba(20, 20, 20, 0.08);

  --font-display: 'Bebas Neue', 'Helvetica Neue', sans-serif;
  --font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-0: var(--onyx);
    --surface-1: #1C1C1C;
    --surface-2: #242424;
    --ink-strong: var(--raw-linen);
    --ink-muted: #9A958C;
    --ink-inverse: var(--onyx);
    --rule: rgba(242, 237, 228, 0.08);
  }
}
'@

# ---------- src/styles/global.css ----------
Write-File "src\styles\global.css" @'
*,
*::before,
*::after { box-sizing: border-box; }

html, body, #root {
  margin: 0;
  padding: 0;
  height: 100%;
}

body {
  background: var(--surface-0);
  color: var(--ink-strong);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

h1, h2, h3, h4 {
  font-family: var(--font-display);
  font-weight: 400;
  letter-spacing: 0.02em;
  margin: 0;
}

button { font-family: inherit; cursor: pointer; }
a { color: inherit; }

.fh-wordmark-stack {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25em;
}
.fh-wordmark {
  font-family: var(--font-display);
  font-size: 1em;
  letter-spacing: 0.02em;
  line-height: 0.9;
  display: inline-flex;
}
.fh-wordmark .field { color: var(--field-gold); }
.fh-wordmark .horse { color: var(--ink-strong); }
.fh-wordmark-stack--inverse .fh-wordmark .horse { color: #B8B8B8; }

.fh-tagline {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.18em;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-left: 0.08em;
}
.fh-wordmark-stack--inverse .fh-tagline { color: #9A958C; }
'@

# ---------- src/components/Wordmark.jsx ----------
Write-File "src\components\Wordmark.jsx" @'
export default function Wordmark({
  inverse = false,
  size = '1rem',
  tagline = false,
  tag = 'FIELD OPERATIONS PLATFORM'
}) {
  return (
    <span
      className={`fh-wordmark-stack${inverse ? ' fh-wordmark-stack--inverse' : ''}`}
      aria-label="Fieldhorse — Field Operations Platform"
    >
      <span className="fh-wordmark" style={{ fontSize: size }}>
        <span className="field">FIELD</span><span className="horse">HORSE</span>
      </span>
      {tagline && <span className="fh-tagline">{tag}</span>}
    </span>
  )
}
'@

# ---------- src/contexts/AuthContext.jsx ----------
Write-File "src\contexts\AuthContext.jsx" @'
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signUp: (email, password) => supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut()
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
'@

# ---------- src/lib/supabase.js ----------
Write-File "src\lib\supabase.js" @'
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[fieldhorse] Missing Supabase env vars. Copy .env.example to .env.local.')
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})
'@

# ---------- src/lib/anthropic.js ----------
Write-File "src\lib\anthropic.js" @'
const MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'

export async function claudeMessage({ system, messages, maxTokens = 1024 }) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, system, messages, max_tokens: maxTokens })
  })
  if (!res.ok) throw new Error(`Claude request failed: ${res.status}`)
  return res.json()
}
'@

# ---------- src/lib/weather.js ----------
Write-File "src\lib\weather.js" @'
export const MURFREESBORO = { lat: 35.8456, lon: -86.3903 }

export async function getWeather(lat = MURFREESBORO.lat, lon = MURFREESBORO.lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto'
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error('weather fetch failed')
  return res.json()
}

export function pourRating(current) {
  if (!current) return { label: '—', tone: 'neutral' }
  const t = current.temperature_2m
  const rain = current.precipitation
  if (t < 40 || t > 90) return { label: 'Poor', tone: 'alert' }
  if (rain > 0.05) return { label: 'Poor', tone: 'alert' }
  if (t < 50 || t > 85) return { label: 'Fair', tone: 'warn' }
  return { label: 'Good', tone: 'ok' }
}
'@

# ---------- src/lib/rateCard.js ----------
Write-File "src\lib\rateCard.js" @'
export const RATE_CARD = {
  concrete:      { unit: 'sqft', low: 8,    high: 12 },
  framing:       { unit: 'lf',   low: 4,    high: 7 },
  drywall:       { unit: 'sqft', low: 2.5,  high: 4 },
  demo:          { unit: 'sqft', low: 3,    high: 6 },
  roofing:       { unit: 'sqft', low: 5,    high: 9 },
  electrical:    { unit: 'point',low: 150,  high: 250 },
  plumbingRough: { unit: 'lump', low: 800,  high: 1500 },
  insulation:    { unit: 'sqft', low: 1.5,  high: 3 },
  lvpFlooring:   { unit: 'sqft', low: 4,    high: 7 },
  paint:         { unit: 'sqft', low: 1.5,  high: 3 },
  permits:       { unit: 'lump', low: 200,  high: 800 },
  outdoorLiving: { unit: 'sqft', low: 25,   high: 65 }
}

export const TAGLINE = 'Run every job like a captain.'
'@

# ---------- src/screens/Login.jsx ----------
Write-File "src\screens\Login.jsx" @'
import Wordmark from '../components/Wordmark.jsx'

export default function Login() {
  return (
    <main style={{ padding: 'var(--space-6)', maxWidth: 420, margin: '0 auto' }}>
      <Wordmark size="2.5rem" tagline />
      <p style={{ color: 'var(--ink-muted)', marginTop: 'var(--space-4)' }}>
        Login stub. Email + password form lands here.
      </p>
    </main>
  )
}
'@

# ---------- src/screens/Onboarding.jsx ----------
Write-File "src\screens\Onboarding.jsx" @'
import Wordmark from '../components/Wordmark.jsx'

export default function Onboarding() {
  return (
    <main style={{ padding: 'var(--space-6)' }}>
      <Wordmark size="2rem" />
      <p style={{ color: 'var(--ink-muted)', marginTop: 'var(--space-4)' }}>
        Onboarding stub. Service picker (concrete, roofing, paint, GC) lands here.
      </p>
    </main>
  )
}
'@

# ---------- src/screens/Home.jsx ----------
Write-File "src\screens\Home.jsx" @'
import Wordmark from '../components/Wordmark.jsx'

export default function Home() {
  return (
    <main style={{ padding: 'var(--space-5)' }}>
      <Wordmark size="2rem" />
      <p style={{ color: 'var(--ink-muted)', marginTop: 'var(--space-3)' }}>
        Home stub. Morning brief, weather, pour conditions land here.
      </p>
    </main>
  )
}
'@

Write-Host ""
Write-Host "Scaffold written to $root"
Write-Host "Next: copy .env.example to .env.local, fill SUPABASE_ANON_KEY, then npm run dev"
