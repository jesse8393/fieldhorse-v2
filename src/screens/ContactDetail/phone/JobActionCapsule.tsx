import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Mic } from 'lucide-react'
import { Button, IconButton } from '../../../components/fh'
import { cx } from '../../../components/fh/cx.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { useKeyboardOpen } from '../../../lib/useKeyboardOpen.ts'
import './job-phone.css'

// The Job page's own bottom bar (spec 8.1 and 9.4): a floating onyx
// capsule above the home indicator, in place of the dock, which hides on
// this screen. It has two variants.
//
// actions (every tab but Quote): camera and microphone keep Capture one
// tap away; the one brushed gold button follows the stage (its label and
// action come from the page's stageCta). Field roles get no stage action,
// so their capsule carries only the camera and the microphone.
//
// The camera opens the phone's camera (or photo picker) straight from the
// tap, then hands the files to the Files tab, which uploads them. The
// microphone opens Capture already attached to this job.
//
// total (the Quote tab, spec 9.6): "Total" with the base total in linen
// and the deposit line under it, and the one brushed gold "Send for
// approval" beside them. When the button is disabled, or does something
// other than the plain send, a short hint sits under it.
//
// Rendered into document.body so no transformed or clipped ancestor can
// pull it off the viewport. Like the dock, it steps aside while the
// on screen keyboard is open, so it never rides up over a field.

type StageAction = { label: string; onClick: () => void }

export type JobActionCapsuleProps =
  | {
      variant?: 'actions'
      action: StageAction | null
      onPhotos: (files: File[]) => void
      onVoice: () => void
    }
  | {
      variant: 'total'
      /** The amount as printed ("$18,458.00") and the line under it. */
      total: { amount: string; note: string }
      action: StageAction & { disabled?: boolean; loading?: boolean; hint?: string }
    }

export default function JobActionCapsule(props: JobActionCapsuleProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const keyboardOpen = useKeyboardOpen()
  const hintId = useId()

  if (typeof document === 'undefined') return null

  if (props.variant === 'total') {
    const { total, action } = props
    return createPortal(
      <div
        className={cx('fhj-capsule fhj-capsule--total fh-onyx-scope', keyboardOpen && 'is-hidden')}
        role="group"
        aria-label="Quote total and send"
      >
        <div className="fhj-capsule__sum">
          <span className="fhj-capsule__label">Total</span>
          <span className="fhj-capsule__amount">{total.amount}</span>
        </div>
        <div className="fhj-capsule__send">
          <Button
            variant="primary"
            size="lg"
            className="fhj-capsule__primary"
            disabled={action.disabled}
            loading={action.loading}
            aria-describedby={action.hint ? hintId : undefined}
            onClick={() => { hapticTap(); action.onClick() }}
          >
            {action.label}
          </Button>
          {action.hint && <span id={hintId} className="fhj-capsule__hint">{action.hint}</span>}
        </div>
        <span className="fhj-capsule__note">{total.note}</span>
      </div>,
      document.body
    )
  }

  const { action, onPhotos, onVoice } = props
  return createPortal(
    <div className={cx('fhj-capsule fh-onyx-scope', !action && 'is-compact', keyboardOpen && 'is-hidden')} role="group" aria-label="Job actions">
      <IconButton
        variant="paper"
        icon={Camera}
        className="fhj-capsule__round"
        aria-label="Take a photo for this job"
        onClick={() => { hapticTap(); inputRef.current?.click() }}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (files.length > 0) onPhotos(files)
        }}
      />
      <IconButton
        variant="paper"
        icon={Mic}
        className="fhj-capsule__round"
        aria-label="Capture a voice note for this job"
        onClick={() => { hapticTap(); onVoice() }}
      />
      {action && (
        <Button
          variant="primary"
          size="lg"
          className="fhj-capsule__primary"
          onClick={() => { hapticTap(); action.onClick() }}
        >
          {action.label}
        </Button>
      )}
    </div>,
    document.body
  )
}
