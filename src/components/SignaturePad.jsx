import { useCallback, useEffect, useRef } from 'react'
import { Eraser } from 'lucide-react'

/**
 * SignaturePad — drawn-signature capture (Phase 4C-4a).
 *
 * Self-contained, no external deps. Pointer Events for mouse + touch +
 * stylus on one code path. Devicepixel-ratio-aware so signatures stay
 * crisp on retina screens. Emits a PNG data URL on pointer-up (never
 * on move). Restores an existing data URL into the canvas when the
 * `value` prop is set externally.
 *
 * Wired into ApproveQuoteSheet in Phase 4C-4b. Lives standalone for
 * now so the canvas mechanics ship + visually QA in isolation.
 *
 * @param {object} props
 * @param {string|null} props.value     PNG data URL (or null when empty)
 * @param {function} props.onChange     fn(dataUrl|null) called on pointer-up + clear
 * @param {boolean} [props.disabled]
 * @param {string} [props.label]        defaults to "Draw signature"
 * @param {number} [props.height]       canvas height in CSS pixels (default 100)
 * @param {string} [props.className]
 * @param {string} [props.hint]         optional helper copy under the pad
 */
export default function SignaturePad({
  value = null,
  onChange,
  disabled = false,
  label = 'Draw signature',
  height = 100,
  className,
  hint = 'Optional — hand the phone to the customer to sign.'
}) {
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const lastPoint = useRef(null)
  // Suppress the redraw loop: when WE emit a data URL, the parent's
  // `value` prop will tick to that same string. The value-restore
  // effect compares against this ref and skips redraw if they match.
  const lastEmitted = useRef(null)

  // DPR-aware sizing. Re-runs on mount + whenever the surface resizes
  // (rotation, layout shift, dev-tools resize). Saves + restores the
  // current ink so resizing doesn't wipe the user's signature.
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const cssW = Math.max(1, Math.floor(rect.width))
    const cssH = Math.max(1, Math.floor(rect.height))
    const targetW = Math.floor(cssW * dpr)
    const targetH = Math.floor(cssH * dpr)
    if (canvas.width === targetW && canvas.height === targetH) return

    let saved = null
    try {
      if (canvas.width > 0 && canvas.height > 0) {
        saved = canvas.toDataURL('image/png')
        if (saved === 'data:,') saved = null
      }
    } catch { /* ignore */ }

    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#121212'
    ctx.fillStyle = '#121212'

    if (saved) {
      const img = new Image()
      img.onload = () => { try { ctx.drawImage(img, 0, 0, cssW, cssH) } catch { /* ignore */ } }
      img.src = saved
    }
  }, [])

  // Mount + resize handling
  useEffect(() => {
    resize()
    if (typeof ResizeObserver === 'undefined') {
      const onWin = () => resize()
      window.addEventListener('resize', onWin)
      return () => window.removeEventListener('resize', onWin)
    }
    const ro = new ResizeObserver(resize)
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [resize])

  // Restore from `value` prop. Skip when it matches what we just emitted
  // (avoids a redraw loop after every pointer-up).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (lastEmitted.current === value) return
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    ctx.clearRect(0, 0, cssW, cssH)
    if (!value) {
      lastEmitted.current = null
      return
    }
    const img = new Image()
    img.onload = () => { try { ctx.drawImage(img, 0, 0, cssW, cssH) } catch { /* ignore */ } }
    img.onerror = () => { /* ignore — leaves canvas blank */ }
    img.src = value
    lastEmitted.current = value
  }, [value])

  // Pointer event drawing. AbortController.signal cleans every listener
  // in one shot when the effect re-runs or the component unmounts.
  useEffect(() => {
    if (disabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ac = new AbortController()

    function pointerPos(e) {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    function down(e) {
      e.preventDefault()
      try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      isDrawing.current = true
      const p = pointerPos(e)
      lastPoint.current = p
      // Single-tap dot — pure tap (no drag) still leaves a mark.
      ctx.beginPath()
      ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2)
      ctx.fill()
    }

    function move(e) {
      if (!isDrawing.current) return
      e.preventDefault()
      const p = pointerPos(e)
      const last = lastPoint.current
      // Quadratic-curve smoothing through midpoint of last+current.
      // Small visual win over plain lineTo, no library needed.
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y)
      ctx.stroke()
      lastPoint.current = p
    }

    function up(e) {
      if (!isDrawing.current) return
      isDrawing.current = false
      try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      // Tail off any in-progress curve to the final point.
      const p = pointerPos(e)
      const last = lastPoint.current
      if (last) {
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
      }
      lastPoint.current = null
      // Emit data URL — the only React-boundary cross per stroke.
      try {
        const dataUrl = canvas.toDataURL('image/png')
        if (dataUrl && dataUrl !== 'data:,') {
          lastEmitted.current = dataUrl
          onChange?.(dataUrl)
        }
      } catch (err) {
        console.warn('[signaturepad] toDataURL failed', err)
      }
    }

    canvas.addEventListener('pointerdown', down, { signal: ac.signal })
    canvas.addEventListener('pointermove', move, { signal: ac.signal })
    canvas.addEventListener('pointerup', up, { signal: ac.signal })
    canvas.addEventListener('pointercancel', up, { signal: ac.signal })

    return () => ac.abort()
  }, [disabled, onChange])

  function clear() {
    if (disabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    lastEmitted.current = null
    onChange?.(null)
  }

  return (
    <div
      className={['fh-sigpad', className].filter(Boolean).join(' ')}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      {label && (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)'
        }}>
          {label}
        </span>
      )}
      <div
        style={{
          position: 'relative',
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border)',
          borderRadius: 12,
          padding: 6,
          opacity: disabled ? 0.55 : 1
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label || 'Signature pad'}
          aria-disabled={disabled}
          style={{
            display: 'block',
            width: '100%',
            height: `${height}px`,
            background: '#F4F0E8',
            borderRadius: 8,
            touchAction: 'none',
            cursor: disabled ? 'not-allowed' : 'crosshair',
            pointerEvents: disabled ? 'none' : 'auto',
            WebkitTapHighlightColor: 'transparent'
          }}
        />
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          aria-label="Clear signature"
          title="Clear signature"
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.92)',
            border: '1px solid var(--v3-border)',
            color: 'var(--v3-text-muted)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'grid',
            placeItems: 'center',
            opacity: disabled ? 0.4 : 1,
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Eraser size={16} aria-hidden="true" />
        </button>
      </div>
      {hint && (
        <span style={{
          fontSize: 11, lineHeight: 1.45,
          color: 'var(--v3-text-faint, var(--v3-text-muted))',
          fontFamily: 'var(--font-body)'
        }}>
          {hint}
        </span>
      )}
    </div>
  )
}
