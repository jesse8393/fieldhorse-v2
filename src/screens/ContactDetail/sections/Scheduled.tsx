import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Calendar, Clock, ArrowRight, Plus } from 'lucide-react'
import { hapticTap } from '../../../lib/haptics.ts'
import { Eyebrow } from '../../../components/v3'

/**
 * Scheduled section, read-only display of fh_schedule entries for this job.
 * Tapping a row jumps to /schedule?d=year month day so the operator lands on the
 * exact day in the calendar UI (and can drag/edit there).
 *
 * Schedule items come from useJobData (no internal fetch). To add a new
 * event, the parent's onOpenAddEvent prop opens AddEventSheet filled
 * with this contact_id.
 */
export default function ScheduledSection({ scheduleItems = [], onOpenAddEvent }: any) {
  const navigate = useNavigate()

  function openOnSchedule(row: any) {
    hapticTap()
    const d = new Date(row.start_at)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    navigate(`/schedule?d=${iso}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow>
          Scheduled
        </Eyebrow>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={() => { hapticTap(); onOpenAddEvent?.() }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '8px 12px', borderRadius: 10,
            background: 'var(--v3-primary-soft)',
            border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
            color: 'var(--v3-primary)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
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
          padding: '24px 16px', borderRadius: 10,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 14, textAlign: 'center', lineHeight: 1.5
        }}>
          Nothing scheduled for this job. Tap <strong>Schedule event</strong> above to add the first one.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scheduleItems.map((e: any) => {
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
                    padding: '12px 12px', borderRadius: 10,
                    background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
                    textAlign: 'left', cursor: 'pointer',
                    color: 'var(--v3-text)', opacity: isPast ? 0.65 : 1,
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <span aria-hidden="true" style={{
                    flexShrink: 0, width: 36, height: 36, borderRadius: 10,
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
                      fontFamily: 'var(--font-body)', fontSize: 12,
                      color: 'var(--v3-text-muted)',
                      display: 'inline-flex', gap: 8, alignItems: 'center',
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
