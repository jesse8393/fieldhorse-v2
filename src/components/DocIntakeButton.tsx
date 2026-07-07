import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Upload, Sparkles, X, Loader2 } from 'lucide-react'
import { compressImageToDataUrl, imageFromClipboardEvent } from '../lib/docIntelligence.ts'
import { hapticTap, hapticSuccess } from './../lib/haptics.ts'
import { toastError } from '../lib/toast.ts'
import { Eyebrow } from './v3'

/**
 * DocIntakeButton — the entry surface for document-intelligence flows.
 *
 * Renders a small gold "Scan doc" button. Tap opens an inline pane with
 * three intake methods:
 *   1. Camera capture  (mobile — uses input[capture=environment])
 *   2. Photo / file upload
 *   3. Paste from clipboard (Cmd-V on a screenshot)
 *
 * Once an image is captured, it's compressed (canvas → JPEG) and handed
 * to the parent's onParse(dataUrl) handler. Parent owns the actual
 * Claude Vision call so each caller can use a different system prompt
 * (lead vs expense vs invoice).
 *
 * Props:
 *   onParse(dataUrl)     async — host runs vision, returns nothing
 *                       (host does its own toast + form fill)
 *   label                primary CTA label (default "Scan doc")
 *   description          one-line copy under the input pane
 *
 * The component handles its own busy state and resets after onParse
 * resolves or rejects.
 */
export default function DocIntakeButton({
  onParse,
  label = 'Scan doc',
  description = 'Photo, screenshot, or paste — we\'ll fill the form.'
}: any) {
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<any>(null)
  const cameraRef = useRef<any>(null)

  // Listen for clipboard paste only while open so we don't intercept
  // pastes elsewhere in the app.
  useEffect(() => {
    if (!open) return
    function onPaste(e: any) {
      const file = imageFromClipboardEvent(e)
      if (file) {
        e.preventDefault()
        handleFile(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleFile(file: any) {
    if (!file || !file.type?.startsWith('image/')) {
      toastError('Need an image', 'Use a photo, screenshot, or PNG/JPG.')
      return
    }
    setBusy(true)
    try {
      const dataUrl = await compressImageToDataUrl(file)
      setPreviewUrl(dataUrl)
      hapticTap()
      // Hand to host. Host does the vision call + form fill + toast.
      await onParse?.(dataUrl)
      hapticSuccess()
      setOpen(false)
      setPreviewUrl('')
    } catch (ex: any) {
      toastError("Couldn't read that image", ex?.message || 'Try a clearer shot.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onClick={() => { hapticTap(); setOpen(true) }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderRadius: 10,
          background: 'var(--v3-glass-tint-2)',
          border: '1px solid var(--v3-border-strong)',
          color: 'var(--ink-strong)',
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer'
        }}
      >
        <Sparkles size={12} />
        {label}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="intake-pane"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              marginTop: 10,
              padding: 14,
              borderRadius: 14,
              background: 'linear-gradient(180deg, rgba(30,20,10,0.5), rgba(20,15,10,0.3))',
              border: '1px solid var(--v3-border-strong)',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => { setOpen(false); setPreviewUrl('') }}
              disabled={busy}
              style={{ position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
            >
              <X size={14} />
            </button>

            <Eyebrow as="div">
              <Sparkles size={12} />
              AI doc parse
            </Eyebrow>
            <p style={{ margin: '6px 0 12px', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
              {description}
            </p>

            {previewUrl && (
              <div style={{ marginBottom: 10, padding: 6, borderRadius: 10, background: 'rgba(0,0,0,0.4)', border: '1px solid var(--rule)' }}>
                <img loading="lazy"src={previewUrl}
                  alt="Preview"
                  style={{ width: '100%', maxHeight: 180, objectFit: 'contain', display: 'block', borderRadius: 6 }}
                />
              </div>
            )}

            {busy ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', borderRadius: 10, background: 'var(--v3-glass-tint-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--ink-strong)', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: '0.12em' }}>
                <Loader2 size={14} style={{ animation: 'fh-spin 700ms linear infinite' }} />
                READING DOC…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  style={intakeBtn()}
                >
                  <Camera size={14} />
                  Take photo
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  style={intakeBtn()}
                >
                  <Upload size={14} />
                  Upload
                </button>
              </div>
            )}

            {!busy && (
              <Eyebrow as="p" style={{ margin: '10px 0 0', color: 'var(--ink-faint)', display: 'flex', justifyContent: 'center' }}>
                or paste an image · ⌘V
              </Eyebrow>
            )}

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function intakeBtn() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '11px 14px',
    borderRadius: 10,
    background: 'var(--surface-2)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    minHeight: 44
  }
}
