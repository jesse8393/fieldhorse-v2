import { motion } from 'framer-motion'
import { Users, UserPlus } from 'lucide-react'
import { hapticTap } from '../../../lib/haptics.ts'
import { Eyebrow } from '../../../components/v3'

/**
 * Invite Partner section, single-action surface that opens InvitePartnerSheet
 * (managed by the parent shell). Surfaces the "share this job with another
 * contractor" capability where it makes sense contextually (Job Detail →
 * Details → Invite Partner).
 */
export default function InvitePartnerSection({ contact, onOpenInvitePartner }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>

      <Eyebrow>
        Invite Partner
      </Eyebrow>

      <div style={{
        padding: '24px 16px',
        borderRadius: 10,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          width: 44, height: 44, borderRadius: 10,
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          color: 'var(--v3-primary)',
          justifyContent: 'center'
        }}>
          <Users size={20} aria-hidden="true" />
        </div>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: 20, fontWeight: 600, letterSpacing: 0,
            color: 'var(--v3-text)'
          }}>
            Share this job with another contractor.
          </h3>
          <p style={{
            margin: '6px 0 0',
            fontFamily: 'var(--font-body)', fontSize: 14,
            color: 'var(--v3-text-muted)', lineHeight: 1.5
          }}>
            They'll see schedule, milestones, and notes, but not your client info or pricing.
            Invite by email; they accept via link.
          </p>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={() => { hapticTap(); onOpenInvitePartner?.() }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', borderRadius: 10,
            background: 'var(--v3-primary)', color: 'var(--v3-on-primary)', border: 'none',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
            letterSpacing: 0, cursor: 'pointer',
            boxShadow: '0 8px 22px rgba(201, 150, 58, 0.32)',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <UserPlus size={14} aria-hidden="true" />
          Invite a partner
        </motion.button>
      </div>
    </div>
  )
}
