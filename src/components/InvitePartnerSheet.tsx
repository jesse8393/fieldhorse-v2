// src/components/InvitePartnerSheet.tsx
//
// v3 rebuild — same partner-invite flow, but rebuilt around the
// cockpit / serif-headline / commit-button pattern shared with
// NewClientSheet, NewLeadSheet, MergeDuplicatesSheet so it stops
// looking like a leftover from an earlier design pass.
//
// New surface (vs. the old version):
//   - Partner-name field on top — used to greet them in the email and
//     stored on fh_job_partners for the inviter's roster.
//   - Role chip selector (Foreman / Sub / Estimator / Other) — wraps
//     into the email body and the partner record.
//   - "Recent partners" suggestion strip — tap a chip to autofill name
//     + email + role from someone you've invited before, sourced from
//     lib/partners.loadPastPartners().
//
// Success pane (post-issuance) is unchanged in spirit: copy link +
// share via navigator.share + Done. Only the chrome and copy were
// tightened up.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Send, Users, X, Copy, Check, Share2, UserPlus } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticTap } from '../lib/haptics.ts'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import { loadPastPartners, PARTNER_ROLES } from '../lib/partners.ts'

function friendlyInviteError(code: any) {
  if (code === 'server_misconfigured') return "Server isn't set up — missing Supabase keys in Netlify env."
  if (code === 'forbidden_or_not_found') return "Can't invite on a job that isn't yours."
  if (code === 'db_insert_failed') return 'Database rejected the invite.'
  if (code === 'job_lookup_failed') return "Couldn't look up the job."
  if (code === 'invalid_email') return 'That email looks invalid.'
  if (code === 'missing_fields') return 'Missing required fields.'
  return `Invite failed (${code}).`
}

export default function InvitePartnerSheet({ open, onOpenChange, contactId, contactName, invitedByUserId }: any) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [sending, setSending] = useState(false)
  const [readyUrl, setReadyUrl] = useState('')
  const [sendFallbackReason, setSendFallbackReason] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [copied, setCopied] = useState(false)
  const [pastPartners, setPastPartners] = useState<any[]>([])
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)
  const copyTimer = useRef<any>(null)

  // Reset state every time the sheet closes so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setName('')
      setEmail('')
      setRole('')
      setSending(false)
      setReadyUrl('')
      setSendFallbackReason('')
      setRecipientEmail('')
      setCopied(false)
      if (copyTimer.current) { clearTimeout(copyTimer.current); copyTimer.current = null }
    }
  }, [open])

  // Load past partners once the sheet opens. Skipped on the success
  // pane since the suggestion strip only matters on the input form.
  useEffect(() => {
    if (!open || readyUrl) return
    let alive = true
    ;(async () => {
      const rows = await loadPastPartners({ excludeJobId: contactId, limit: 6 })
      if (alive) setPastPartners(rows)
    })()
    return () => { alive = false }
  }, [open, readyUrl, contactId])

  function pickPast(p: any) {
    hapticTap()
    setName(p.name || '')
    setEmail(p.email || '')
    setRole(p.role || '')
  }

  async function submit(e: any) {
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
          partner_email: trimmed,
          partner_name: name.trim() || null,
          partner_role: role || null,
          send_email: true
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = data?.error || `http_${res.status}`
        const friendly = friendlyInviteError(code)
        const detail = data?.detail || data?.hint
        throw new Error(detail ? `${friendly} — ${detail}` : friendly)
      }
      setRecipientEmail(trimmed)
      if (data?.sent) {
        toastSuccess('Invite sent', `${name.trim() || trimmed} will get the link shortly.`)
        onOpenChange(false)
      } else if (data?.invite_url) {
        if (data?.sender_not_configured) {
          setSendFallbackReason('Email sender is not configured yet — share the link manually below.')
        } else if (data?.send_failed) {
          const detail = data?.detail || 'Unknown provider error'
          const status = data?.provider_status ? ` (HTTP ${data.provider_status})` : ''
          setSendFallbackReason(`Email send failed${status}: ${detail}`)
        }
        setReadyUrl(data.invite_url)
      } else {
        toastSuccess('Invite sent', `${trimmed} will get the link shortly.`)
        onOpenChange(false)
      }
    } catch (err: any) {
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
    } catch (ex: any) {
      console.error('[partner-invite] clipboard.writeText failed', ex)
    }
    if (!wrote) {
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
      } catch (ex: any) {
        console.error('[partner-invite] execCommand copy fallback failed', ex)
      }
    }
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
    if (!navigator.share) { copyLink(); return }
    try {
      const greeting = name.trim() ? `${name.trim()},\n\n` : ''
      const body = `${greeting}Co-manage ${contactName || 'this job'} with me:\n\n${readyUrl}`
      await navigator.share({
        title: 'Partner invite',
        text: body,
        url: readyUrl
      })
    } catch (ex: any) {
      if (ex?.name !== 'AbortError') {
        console.error('[partner-invite] navigator.share failed', ex)
      }
    }
  }

  const labelStyle: import('react').CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }
  const fieldStyle: import('react').CSSProperties = {
    padding: '11px 14px',
    borderRadius: 12,
    background: 'var(--surface-2)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    scrollMarginTop: 96,
    scrollMarginBottom: 120
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={drawerStyle}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(245, 242, 234, 0.62)' }}>
            <Users size={12} />
            Partner
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              {readyUrl ? <>Invite ready.</> : <>Invite a partner.</>}
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45, overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            {readyUrl
              ? <>Send this link to {name.trim() || 'your partner'}. It gives them access to <strong style={{ color: 'var(--ink-strong)' }}>{contactName || 'this job'}</strong> only — nothing else from your account.</>
              : <>They'll get a link to join <strong style={{ color: 'var(--ink-strong)' }}>{contactName || 'this job'}</strong>. They'll only see this specific job — not your other contacts, rates, or data.</>
            }
          </DrawerDescription>
        </DrawerHeader>

        {readyUrl ? (
          <SuccessPane
            readyUrl={readyUrl}
            sendFallbackReason={sendFallbackReason}
            recipientEmail={recipientEmail}
            copied={copied}
            onCopy={copyLink}
            onShare={shareLink}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <form
            ref={formRef}
            onSubmit={submit}
            style={{
              ...formStyle(),
              flex: 1,
              minHeight: 0
            }}
          >
            {pastPartners.length > 0 && (
              <RecentPartnersStrip partners={pastPartners} onPick={pickPast} />
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Partner name</span>
              <div style={{ position: 'relative' }}>
                <UserPlus size={16} style={iconStyle} />
                <input
                  type="text"
                  autoComplete="name"
                  disabled={sending}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Mike Reilly"
                  style={{ ...fieldStyle, padding: '11px 14px 11px 40px' }}
                />
              </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Partner email *</span>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={iconStyle} />
                <input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  disabled={sending}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mike@example.com"
                  style={{ ...fieldStyle, padding: '11px 14px 11px 40px' }}
                />
              </div>
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Role on this job</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PARTNER_ROLES.map((r) => {
                  const active = role === r
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { hapticTap(); setRole(active ? '' : r) }}
                      disabled={sending}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 999,
                        border: active
                          ? '1px solid rgba(201,150,58,0.4)'
                          : '1px solid var(--rule)',
                        background: active
                          ? 'rgba(201,150,58,0.14)'
                          : 'var(--surface-2)',
                        color: active
                          ? 'var(--ink-strong)'
                          : 'var(--ink-muted)',
                        fontFamily: 'var(--font-body)',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: sending ? 'wait' : 'pointer',
                        transition: 'all 160ms ease'
                      }}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={sending}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--surface-2)', border: '1px solid var(--rule)',
                  color: 'var(--ink-strong)',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                  cursor: sending ? 'wait' : 'pointer'
                }}
              >
                <X size={14} />
                Cancel
              </button>
              <motion.button
                type="submit"
                whileTap={{ scale: sending ? 1 : 0.98 }}
                disabled={sending}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 14px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                  color: 'var(--onyx)',
                  fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
                  cursor: sending ? 'wait' : 'pointer',
                  boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                  opacity: sending ? 0.6 : 1
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

const iconStyle: import('react').CSSProperties = {
  position: 'absolute',
  left: 14, top: '50%',
  transform: 'translateY(-50%)',
  color: 'var(--ink-muted)',
  pointerEvents: 'none'
}

function RecentPartnersStrip({ partners, onPick }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--ink-muted)'
      }}>
        Recent partners
      </span>
      <div style={{
        display: 'flex', flexWrap: 'nowrap', gap: 8,
        overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        paddingBottom: 2
      }}>
        {partners.map((p: any) => (
          <button
            key={p.email}
            type="button"
            onClick={() => onPick(p)}
            style={{
              flexShrink: 0,
              maxWidth: 220,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 12px',
              borderRadius: 999,
              background: 'var(--surface-2)',
              border: '1px solid var(--rule)',
              color: 'var(--ink-strong)',
              fontFamily: 'var(--font-body)', fontSize: 12,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <span aria-hidden="true" style={{
              width: 22, height: 22, borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.06)',
              color: 'var(--ink-strong)',
              display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 11, letterSpacing: '0.04em',
              flexShrink: 0
            }}>
              {(p.name || p.email).charAt(0).toUpperCase()}
            </span>
            <span style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              minWidth: 0, lineHeight: 1.2
            }}>
              <span style={{
                fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: 160
              }}>
                {p.name || p.email}
              </span>
              {p.role && (
                <span style={{
                  marginTop: 1,
                  fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--ink-muted)'
                }}>
                  {p.role}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SuccessPane({ readyUrl, sendFallbackReason, recipientEmail, copied, onCopy, onShare, onClose }: any) {
  return (
    <div style={{
      padding: '6px 20px max(20px, calc(20px + env(safe-area-inset-bottom)))',
      display: 'flex', flexDirection: 'column', gap: 12,
      boxSizing: 'border-box', maxWidth: '100%', minWidth: 0,
      overflowY: 'auto', flex: 1, minHeight: 0
    }}>
      {sendFallbackReason && (
        <div
          role="status"
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            color: 'var(--ink-strong)',
            fontFamily: 'var(--font-body)',
            fontSize: 12, lineHeight: 1.45
          }}
        >
          {sendFallbackReason}
          {recipientEmail && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-muted)' }}>
              Recipient: {recipientEmail}
            </div>
          )}
        </div>
      )}
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
          onClick={onCopy}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 12,
            background: copied ? 'rgba(45,122,79,0.14)' : 'var(--surface-2)',
            border: copied ? '1px solid rgba(45,122,79,0.4)' : '1px solid var(--rule)',
            color: copied ? 'var(--signal-green)' : 'var(--ink-strong)',
            fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.12em',
            cursor: 'pointer'
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'COPIED' : 'COPY LINK'}
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onShare}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
            cursor: 'pointer',
            boxShadow: '0 6px 16px rgba(201,150,58,0.3)'
          }}
        >
          <Share2 size={14} />
          SHARE
        </motion.button>
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          padding: '10px 14px', borderRadius: 12,
          background: 'transparent', border: '1px solid var(--rule)',
          color: 'var(--ink-muted)',
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        Done
      </button>
    </div>
  )
}
