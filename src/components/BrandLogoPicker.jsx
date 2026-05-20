import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, Trash2, Image as ImageIcon, Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import { toastSuccess, toastError } from '../lib/toast.ts'

const BUCKET = 'company-logos'
const MAX_BYTES = 1 * 1024 * 1024 // 1 MB per spec
const ACCEPT = 'image/png,image/svg+xml'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 // 1 year

function extFromType(type, fallback = 'png') {
  if (type === 'image/svg+xml') return 'svg'
  if (type === 'image/png') return 'png'
  return fallback
}

function mimeOk(type) {
  return type === 'image/png' || type === 'image/svg+xml'
}

/**
 * BrandLogoPicker — Phase 16 branding control.
 *
 * - Private supabase bucket `company-logos` (migration 005).
 * - 1 MB cap, PNG / SVG only, per spec.
 * - Live preview in a simulated dark header card before saving.
 * - Save uploads to company-logos/<user_id>/logo.<ext> and persists a
 *   signed URL (1 yr TTL) to profiles.logo_url via onSaved(url).
 * - Remove deletes all logo.* objects in the user's folder and clears
 *   profiles.logo_url via onRemoved().
 */
export default function BrandLogoPicker({ logoUrl, companyName, fullName, onSaved, onRemoved }) {
  const { user } = useAuth()
  const inputRef = useRef(null)
  const [pendingFile, setPendingFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)

  function resetPicker() {
    setPendingFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!mimeOk(file.type)) {
      toastError('Use PNG or SVG for best results')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    if (file.size > MAX_BYTES) {
      toastError('Logo too large — keep it under 1 MB')
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    // Decode check (skip for SVG — img tag decodes it natively at render time)
    if (file.type === 'image/png') {
      const probe = new window.Image()
      const probeUrl = URL.createObjectURL(file)
      probe.onload = () => {
        URL.revokeObjectURL(probeUrl)
        setPendingFile(file)
        setPreviewUrl(URL.createObjectURL(file))
      }
      probe.onerror = () => {
        URL.revokeObjectURL(probeUrl)
        toastError("Couldn't read image — try another file")
      }
      probe.src = probeUrl
    } else {
      setPendingFile(file)
      setPreviewUrl(URL.createObjectURL(file))
    }
  }

  async function save() {
    if (!pendingFile || !user?.id) return
    setBusy(true)
    try {
      const ext = extFromType(pendingFile.type)
      const path = `${user.id}/logo.${ext}`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, pendingFile, {
          upsert: true,
          cacheControl: '3600',
          contentType: pendingFile.type
        })
      if (upErr) throw upErr
      const { data, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (signErr || !data?.signedUrl) throw signErr || new Error('No signed URL')
      await onSaved?.(data.signedUrl)
      toastSuccess('Logo saved', 'Header updated across the app')
      resetPicker()
    } catch (ex) {
      toastError("Couldn't upload logo", ex?.message || 'Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!user?.id) return
    setBusy(true)
    try {
      // Delete all possible extensions we might have written
      const paths = ['png', 'svg'].map((e) => `${user.id}/logo.${e}`)
      await supabase.storage.from(BUCKET).remove(paths)
      await onRemoved?.()
      toastSuccess('Logo removed', 'Header reverts to your company name')
      resetPicker()
    } catch (ex) {
      toastError("Couldn't remove logo", ex?.message || 'Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const hasPending = !!pendingFile && !!previewUrl
  const displayedLogo = hasPending ? previewUrl : logoUrl

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
        Company logo
      </span>

      {/* Simulated dark header preview */}
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 14,
          background: 'linear-gradient(180deg, rgba(20,20,20,0.95), rgba(14,14,14,0.95))',
          border: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: 64,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(201,150,58,0.08)', border: '1px solid rgba(201,150,58,0.35)', color: 'var(--field-gold-bright)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.04em', opacity: 0.72 }}>FH</span>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 36 }}>
          {displayedLogo ? (
            <img
              src={displayedLogo}
              alt={companyName || 'Company logo preview'}
              style={{ maxHeight: 36, maxWidth: '70%', objectFit: 'contain' }}
            />
          ) : companyName ? (
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>{companyName}</span>
          ) : fullName ? (
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-strong)' }}>{fullName}</span>
          ) : (
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.14em' }}>
              <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
              <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
            </span>
          )}
        </div>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--rule)' }} />
      </div>

      <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
        Transparent PNG works best. Renders on a dark header. Max 1&nbsp;MB · PNG or SVG.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={handleFile}
      />

      {!hasPending ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{
              flex: 1,
              minWidth: 180,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
              color: 'var(--onyx)',
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              letterSpacing: '0.14em',
              cursor: busy ? 'default' : 'pointer',
              boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
              opacity: busy ? 0.6 : 1
            }}
          >
            <Upload size={14} />
            {logoUrl ? 'REPLACE LOGO' : 'UPLOAD LOGO'}
          </motion.button>
          {logoUrl && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={remove}
              disabled={busy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--surface-2)',
                border: '1px solid var(--rule)',
                color: 'var(--ink-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                cursor: busy ? 'default' : 'pointer'
              }}
            >
              <Trash2 size={13} />
              Remove
            </motion.button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            type="button"
            onClick={resetPicker}
            disabled={busy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--surface-2)',
              border: '1px solid var(--rule)',
              color: 'var(--ink-strong)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
              cursor: busy ? 'default' : 'pointer'
            }}
          >
            Cancel
          </button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={save}
            disabled={busy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 14px',
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
              color: 'var(--onyx)',
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              letterSpacing: '0.14em',
              cursor: busy ? 'default' : 'pointer',
              boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
              opacity: busy ? 0.6 : 1
            }}
          >
            <Check size={14} />
            {busy ? 'SAVING…' : 'SAVE LOGO'}
          </motion.button>
        </div>
      )}
    </div>
  )
}
