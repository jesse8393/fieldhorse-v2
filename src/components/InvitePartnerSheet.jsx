import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Send, Users, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { toastSuccess, toastError } from '../lib/toast.js'

/**
 * InvitePartnerSheet — Vaul drawer for inviting someone to co-manage a single job.
 *
 * Wiring status: UI only. onSubmit currently POSTs to /api/partner-invite
 * (the netlify/functions/partner-invite.js skeleton) but that function is a
 * no-op until migration 004_partner_jobs.sql is applied to Supabase and the
 * function body is filled in. For now the submit path succeeds visually and
 * copies the stub invite URL to clipboard so the UX can be test-driven
 * end-to-end before the backend is wired.
 */
function friendlyInviteError(code) {
  if (code === 'server_misconfigured') return "Server isn't set up — missing Supabase keys in Netlify env."
  if (code === 'forbidden_or_not_found') return "Can't invite on a job that isn't yours."
  if (code === 'db_insert_failed') return 'Database rejected the invite.'
  if (code === 'job_lookup_failed') return "Couldn't look up the job."
  if (code === 'invalid_email') return 'That email looks invalid.'
  if (code === 'missing_fields') return 'Missing required fields.'
  return `Invite failed (${code}).`
}

export default function InvitePartnerSheet({ open, onOpenChange, contactId, contactName, invitedByUserId }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) {
      setEmail('')
      setSending(false)
    }
  }, [open])

  async function submit(e) {
    e?.preventDefault?.()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toastError('Enter a valid email', 'We need an email to send the invite to.')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/partner-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: contactId,
          invited_by_user_id: invitedByUserId,
          partner_email: trimmed
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = data?.error || `http_${res.status}`
        const friendly = friendlyInviteError(code)
        const detail = data?.detail || data?.hint
        throw new Error(detail ? `${friendly} — ${detail}` : friendly)
      }
      if (data?.invite_url) {
        await navigator.clipboard.writeText(data.invite_url).catch(() => {})
        toastSuccess('Invite ready', 'Link copied. Paste it into a text or email to send to your partner.')
      } else {
        toastSuccess('Invite sent', `${trimmed} will get the link shortly.`)
      }
      onOpenChange(false)
    } catch (err) {
      toastError("Couldn't send invite", err?.message || 'Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  const boxSizing = 'border-box'

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={{ maxWidth: '100%', overflowX: 'hidden' }}
      >
        <DrawerHeader className="ui:text-left" style={{ boxSizing, maxWidth: '100%', minWidth: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <Users size={12} />
            Partner
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Invite a{' '}
              <em className="fh-font-serif-italic fh-text-gradient-gold">partner.</em>
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            They'll get an email link to join <strong style={{ color: 'var(--ink-strong)' }}>{contactName || 'this job'}</strong>. They'll only see this specific job — not your other contacts, rates, or data.
          </DrawerDescription>
        </DrawerHeader>

        <form
          onSubmit={submit}
          style={{ padding: '6px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing, maxWidth: '100%', minWidth: 0 }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, boxSizing, maxWidth: '100%' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Partner email</span>
            <div style={{ position: 'relative', boxSizing, maxWidth: '100%' }}>
              <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                autoFocus
                disabled={sending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="buddy@example.com"
                style={{ width: '100%', boxSizing, padding: '12px 14px 12px 40px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }}
              />
            </div>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4, boxSizing, maxWidth: '100%' }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={sending}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 0, boxSizing }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.97 }}
              disabled={sending}
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
                fontSize: 14,
                letterSpacing: '0.14em',
                cursor: sending ? 'default' : 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: sending ? 0.6 : 1,
                minWidth: 0,
                boxSizing
              }}
            >
              <Send size={14} />
              {sending ? 'SENDING…' : 'SEND INVITE'}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
