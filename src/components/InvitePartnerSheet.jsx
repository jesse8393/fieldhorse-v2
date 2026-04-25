import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Send, Users, X, Copy, Check, Share2 } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { toastSuccess, toastError } from '../lib/toast.js'

/**
 * InvitePartnerSheet — Vaul drawer for inviting someone to co-manage a
 * single job.
 *
 * Phase 18.3 rebuild: kill the "link copied" lie. iOS standalone PWAs
 * reject navigator.clipboard.writeText() when it's called after an
 * async fetch (loses the user-gesture context). The old flow always
 * toasted "Link copied" even when the write silently rejected; partners
 * got nothing.
 *
 * New flow:
 *  - POST creates the invite, returns invite_url.
 *  - Sheet flips to a "success pane" with the URL visible + two
 *    explicit buttons:
 *       [COPY LINK]  — inside a real tap handler, retries safely.
 *       [SHARE]      — navigator.share({ url }) so iOS Share Sheet
 *                      handles Messages/Mail/AirDrop natively; this
 *                      is the reliable path in standalone PWA mode.
 *  - Clipboard result is console.logged so Safari Web Inspector shows
 *    what actually happened.
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
  const [readyUrl, setReadyUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(null)

  useEffect(() => {
    if (!open) {
      setEmail('')
      setSending(false)
      setReadyUrl('')
      setCopied(false)
      if (copyTimer.current) { clearTimeout(copyTimer.current); copyTimer.current = null }
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
        // Flip the sheet to the success pane. DO NOT touch the clipboard
        // here — on iOS standalone PWA, writing the clipboard after a
        // fetch-await chain loses the user-gesture context and silently
        // rejects. The Copy / Share buttons in the success pane run
        // inside a direct tap handler which is clipboard-safe.
        setReadyUrl(data.invite_url)
      } else {
        toastSuccess('Invite sent', `${trimmed} will get the link shortly.`)
        onOpenChange(false)
      }
    } catch (err) {
      toastError("Couldn't send invite", err?.message || 'Check your connection and try again.')
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    if (!readyUrl) return
    let wrote = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(readyUrl)
        wrote = true
      }
    } catch (ex) {
      // eslint-disable-next-line no-console
      console.error('[partner-invite] clipboard.writeText failed', ex)
    }
    if (!wrote) {
      // Legacy fallback — create a hidden textarea, select, execCommand
      // copy. Works in iOS standalone when the modern API refuses.
      try {
        const ta = document.createElement('textarea')
        ta.value = readyUrl
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        ta.style.pointerEvents = 'none'
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, readyUrl.length)
        wrote = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch (ex) {
        // eslint-disable-next-line no-console
        console.error('[partner-invite] execCommand copy fallback failed', ex)
      }
    }
    // eslint-disable-next-line no-console
    console.log('[partner-invite] copy result:', wrote)
    if (wrote) {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
      toastSuccess('Link copied', 'Paste it into a text or email.')
    } else {
      toastError("Couldn't copy automatically", 'Long-press the link above to copy it manually.')
    }
  }

  async function shareLink() {
    if (!readyUrl) return
    if (!navigator.share) {
      // No Share Sheet on this device — fall back to copy.
      copyLink()
      return
    }
    try {
      await navigator.share({
        title: 'Fieldhorse partner invite',
        text: `Co-manage ${contactName || 'this job'} with me on Fieldhorse.`,
        url: readyUrl
      })
    } catch (ex) {
      // User dismissed the sheet — not an error.
      if (ex?.name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.error('[partner-invite] navigator.share failed', ex)
      }
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
              {readyUrl ? (
                <>Invite ready.</>
              ) : (
                <>Invite a partner.</>
              )}
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {readyUrl
              ? <>Send this link to your partner. It gives them access to <strong style={{ color: 'var(--ink-strong)' }}>{contactName || 'this job'}</strong> only — nothing else from your account.</>
              : <>They'll get a link to join <strong style={{ color: 'var(--ink-strong)' }}>{contactName || 'this job'}</strong>. They'll only see this specific job — not your other contacts, rates, or data.</>
            }
          </DrawerDescription>
        </DrawerHeader>

        {readyUrl ? (
          <div style={{ padding: '6px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing, maxWidth: '100%', minWidth: 0 }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--surface-2)',
                border: '1px solid var(--rule)',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                fontSize: 12,
                color: 'var(--ink-strong)',
                overflowWrap: 'anywhere',
                wordBreak: 'break-all',
                userSelect: 'all',
                WebkitUserSelect: 'all'
              }}
            >
              {readyUrl}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={copyLink}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 14px', borderRadius: 12,
                  background: copied ? 'rgba(45,122,79,0.14)' : 'var(--surface-2)',
                  border: copied ? '1px solid rgba(45,122,79,0.4)' : '1px solid var(--rule)',
                  color: copied ? 'var(--signal-green)' : 'var(--ink-strong)',
                  fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.12em',
                  cursor: 'pointer', minWidth: 0, boxSizing
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'COPIED' : 'COPY LINK'}
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={shareLink}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 14px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                  color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 14,
                  letterSpacing: '0.14em', cursor: 'pointer',
                  boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                  minWidth: 0, boxSizing
                }}
              >
                <Share2 size={14} />
                SHARE
              </motion.button>
            </div>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{ padding: '10px 14px', borderRadius: 12, background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        ) : (
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
                  style={{ width: '100%', boxSizing, padding: '12px 14px 12px 40px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }}
                />
              </div>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4, boxSizing, maxWidth: '100%' }}>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={sending}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 0, boxSizing }}
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
        )}
      </DrawerContent>
    </Drawer>
  )
}
