import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Calendar, Clock, ArrowRight, Plus } from 'lucide-react'
import { hapticTap } from '../../../lib/haptics.js'

/**
 * Scheduled section — read-only display of fh_schedule entries for this job.
 * Tapping a row jumps to /schedule?d=YYYY-MM-DD so the operator lands on the
 * exact day in the calendar UI (and can drag/edit there).
 *
 * Schedule items come from useJobData (no internal fetch). To add a new
 * event, the parent's onOpenAddEvent prop opens AddEventSheet pre-filled
 * with this contact_id.
 */
export default function ScheduledSection({ scheduleItems = [], onOpenAddEvent }) {
  const navigate = useNavigate()

  function openOnSchedule(row) {
    hapticTap()
    const d = new Date(row.start_at)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    navigate(`/schedule?d=${iso}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)'
        }}>
          Scheduled
        </span>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => { hapticTap(); onOpenAddEvent?.() }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 999,
            background: 'var(--v3-primary-soft)',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Plus size={11} aria-hidden="true" />
          Schedule event
        </motion.button>
      </div>

      {scheduleItems.length === 0 ? (
        <div style={{
          padding: '20px 18px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center', lineHeight: 1.5
        }}>
          Nothing scheduled for this job. Tap <strong>Schedule event</strong> above to add the first one.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {scheduleItems.map((e) => {
            const d = new Date(e.start_at)
            const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
            const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            const isPast = d.getTime() < Date.now()
            return (
              <li key={e.id}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.99 }}
                  onClick={() => openOnSchedule(e)}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 12,
                    background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
                    textAlign: 'left', cursor: 'pointer',
                    color: 'var(--v3-text)', opacity: isPast ? 0.65 : 1,
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <span aria-hidden="true" style={{
                    flexShrink: 0, width: 36, height: 36, borderRadius: 11,
                    background: 'var(--v3-primary-soft)',
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                    color: 'var(--v3-primary)',
                    display: 'grid', placeItems: 'center'
                  }}>
                    <Calendar size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>
                      {e.title || 'Untitled'}
                    </div>
                    <div style={{
                      marginTop: 3,
                      fontFamily: 'var(--font-body)', fontSize: 11,
                      color: 'var(--v3-text-muted)',
                      display: 'inline-flex', gap: 6, alignItems: 'center',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {dateStr}
                      <span aria-hidden="true">·</span>
                      <Clock size={10} aria-hidden="true" /> {timeStr}
                    </div>
                  </div>
                  <ArrowRight size={14} aria-hidden="true" color="var(--v3-text-muted)" />
                </motion.button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
