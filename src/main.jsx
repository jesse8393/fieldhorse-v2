import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { ProfileProvider } from './contexts/ProfileContext.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import './styles/tokens.css'
import './styles/global.css'
import './styles/v3.css'
// Loaded LAST so cascade-equal rules win. See file header for context.
import './styles/mobile-keyboard-fix.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter
        future={{
          // Opt in to v7 behavior now so the warnings stop and we don't
          // have to scramble when v7 ships.
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <ThemeProvider>
          <AuthProvider>
            <ProfileProvider>
              <App />
            </ProfileProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
)
