import { useEffect, useState } from 'react'
import { watchAppUpdates } from '../lib/appUpdates.ts'
import { Button } from './fh'
import './app-update-notice.css'

export default function AppUpdateNotice() {
  const [ready, setReady] = useState(false)
  useEffect(() => watchAppUpdates(() => setReady(true)), [])
  if (!ready) return null
  return (
    <section className="fh-app-update" aria-label="App update" role="status">
      <div><strong>Update ready</strong><p>Save your work, then reload.</p></div>
      <Button variant="secondary" size="mini" onClick={() => window.location.reload()}>Reload app</Button>
    </section>
  )
}
