import { useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

export default function LogoUploader({ logoUrl, companyName, onUpload, size = 'md' }) {
  const { user } = useAuth()
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')

    if (!file.type.startsWith('image/')) {
      setErr('Images only')
      return
    }
    if (file.size > MAX_BYTES) {
      setErr('Max 2 MB')
      return
    }
    if (!user?.id) {
      setErr('Sign in first')
      return
    }

    setBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${user.id}/logo.${ext}`

      const { error: upErr } = await supabase.storage
        .from('logos')
        .upload(path, file, {
          upsert: true,
          cacheControl: '60',
          contentType: file.type
        })
      if (upErr) throw upErr

      const { data } = supabase.storage.from('logos').getPublicUrl(path)
      const url = `${data.publicUrl}?v=${Date.now()}`
      await onUpload?.(url)
    } catch (ex) {
      setErr(ex.message || 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className={`fh-logo fh-logo--${size}`}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={handleFile}
      />
      <button
        type="button"
        className={`fh-logo__btn${logoUrl ? ' has-logo' : ''}`}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={logoUrl ? 'Replace logo' : 'Upload company logo'}
        title={logoUrl ? 'Replace logo' : 'Upload company logo'}
      >
        {logoUrl ? (
          <img src={logoUrl} alt={companyName || 'Company logo'} className="fh-logo__img" />
        ) : (
          <span className="fh-logo__placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="11" r="2" />
              <path d="M21 15l-5-5-7 7" />
            </svg>
          </span>
        )}
        {busy && <span className="fh-logo__spinner" aria-hidden="true" />}
      </button>
      {err && <span className="fh-logo__err" role="alert">{err}</span>}
    </div>
  )
}
