// src/components/MergeDuplicatesSheet.jsx
//
// Review-and-merge sheet for duplicate clients. Receives pre-detected
// clusters from Clients.jsx; for each cluster the user picks a survivor
// (defaults to the oldest record so manual edits aren't blown away) and
// commits the merge. Aggregates recompute server-side via trigger so
// the parent screen only needs to reload its rows.
//
// Each cluster is committed independently — partial merges are fine.
// The sheet keeps itself open until every cluster is resolved or the
// user closes manually.

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Users, Check, AlertTriangle, X } from 'lucide-react'
import { hapticTap, hapticMedium, hapticError } from '../lib/haptics.js'
import { toastSuccess, toastError } from '../lib/toast.js'
import { mergeClients } from '../lib/clientMerge.ts'

function fmtPhone(n) {
  if (!n) return ''
  const digits = String(n).replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return n
}

function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MergeDuplicatesSheet({ open, userId, clusters, onClose, onMerged }) {
  const [selected, setSelected] = useState({})
  const [busyKey, setBusyKey] = useState(null)
  const [resolved, setResolved] = useState(() => new Set())

  // Reset whenever the sheet opens with a new batch
  useEffect(() => {
    if (!open) return
    const next = {}
    for (const c of clusters || []) {
      const oldest = [...c.members].sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0
        const db = b.created_at ? new Date(b.created_at).getTime() : 0
        return da - db
      })[0]
      if (oldest) next[c.key] = oldest.id
    }
    setSelected(next)
    setResolved(new Set())
    setBusyKey(null)
  }, [open, clusters])

  const remaining = useMemo(
    () => (clusters || []).filter((c) => !resolved.has(c.key)),
    [clusters, resolved]
  )

  async function commitMerge(cluster) {
    const survivorId = selected[cluster.key]
    const survivor = cluster.members.find((m) => m.id === survivorId)
    if (!survivor) {
      hapticError()
      toastError('Pick a survivor', 'Tap the client to keep.')
      return
    }
    const losers = cluster.members.filter((m) => m.id !== survivor.id)
    if (losers.length === 0) return

    setBusyKey(cluster.key)
    try {
      const result = await mergeClients({ userId, survivor, losers })
      hapticMedium()
      toastSuccess(
        `Merged ${losers.length + 1} into 1`,
        result.reassigned > 0 ? `${result.reassigned} jobs reassigned` : 'No jobs needed reassigning'
      )
      setResolved((prev) => {
        const next = new Set(prev)
        next.add(cluster.key)
        return next
      })
      onMerged?.()
    } catch (err) {
      hapticError()
      toastError("Couldn't merge", err?.message || 'Unknown error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v && !busyKey) onClose?.() }}>
      <DrawerContent
        className="vaul-drawer-content"
        style={{
          maxHeight: '92vh',
          background: 'var(--v3-bg)',
          border: 'none',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column'
        }}
      >
        <DrawerHeader style={{
          padding: '14px 20px 10px',
          borderBottom: '1px solid var(--v3-border)',
          background: 'var(--v3-surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden="true" style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
              color: 'var(--v3-primary)',
              display: 'grid', placeItems: 'center'
            }}>
              <Users size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DrawerTitle style={{
                margin: 0, fontFamily: 'var(--font-display)', fontSize: 18,
                color: 'var(--v3-text)', letterSpacing: '-0.005em'
              }}>
                Merge duplicates
              </DrawerTitle>
              <DrawerDescription style={{
                margin: '2px 0 0', fontFamily: 'var(--font-body)', fontSize: 11,
                color: 'var(--v3-text-muted)'
              }}>
                {remaining.length === 0 ? 'All clean.' : `${remaining.length} ${remaining.length === 1 ? 'cluster' : 'clusters'} to review`}
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => { if (!busyKey) onClose?.() }}
              aria-label="Close"
              style={{
                width: 32, height: 32, borderRadius: 10,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border-strong)',
                color: 'var(--v3-text)',
                display: 'grid', placeItems: 'center',
                cursor: busyKey ? 'wait' : 'pointer'
              }}
            >
              <X size={14} />
            </button>
          </div>
        </DrawerHeader>

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 20px 28px',
          display: 'flex', flexDirection: 'column', gap: 14
        }}>
          {remaining.length === 0 && (
            <div style={{
              padding: '24px 20px', borderRadius: 16,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border-strong)',
              textAlign: 'center', color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', fontSize: 13
            }}>
              No duplicate clusters left. Nice cleanup.
            </div>
          )}
          {remaining.map((cluster) => (
            <ClusterCard
              key={cluster.key}
              cluster={cluster}
              survivorId={selected[cluster.key]}
              onPick={(id) => { hapticTap(); setSelected((s) => ({ ...s, [cluster.key]: id })) }}
              onCommit={() => commitMerge(cluster)}
              busy={busyKey === cluster.key}
              disabled={!!busyKey && busyKey !== cluster.key}
            />
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function ClusterCard({ cluster, survivorId, onPick, onCommit, busy, disabled }) {
  const matchedOn = cluster.matchedOn?.length ? cluster.matchedOn.join(' & ') : 'phone/email'
  return (
    <section style={{
      borderRadius: 16,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border-strong)',
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 8px rgba(0, 0, 0, 0.25)',
      overflow: 'hidden'
    }}>
      <header style={{
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--v3-border)',
        background: 'var(--v3-surface-2)'
      }}>
        <AlertTriangle size={13} aria-hidden="true" style={{ color: 'var(--v3-primary)' }} />
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: 'var(--v3-primary-bright, var(--v3-primary))'
        }}>
          {cluster.members.length} duplicates · matched on {matchedOn}
        </span>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {cluster.members.map((m, i) => {
          const isSurvivor = m.id === survivorId
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m.id)}
                disabled={busy || disabled}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  background: isSurvivor ? 'color-mix(in srgb, var(--v3-primary) 8%, transparent)' : 'transparent',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--v3-border)',
                  textAlign: 'left',
                  color: 'inherit',
                  cursor: busy || disabled ? 'wait' : 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <span aria-hidden="true" style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: `2px solid ${isSurvivor ? 'var(--v3-primary)' : 'var(--v3-border-strong)'}`,
                  background: isSurvivor ? 'var(--v3-primary)' : 'transparent',
                  display: 'grid', placeItems: 'center',
                  color: 'var(--v3-on-primary)'
                }}>
                  {isSurvivor && <Check size={11} strokeWidth={3} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 14, fontWeight: 700,
                    color: 'var(--v3-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {m.name || 'Unnamed'}
                    {isSurvivor && (
                      <span style={{
                        marginLeft: 8,
                        fontFamily: 'var(--font-body)',
                        fontSize: 9, fontWeight: 700,
                        letterSpacing: '0.16em', textTransform: 'uppercase',
                        color: 'var(--v3-primary)'
                      }}>
                        Keep
                      </span>
                    )}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-body)',
                    fontSize: 11,
                    color: 'var(--v3-text-muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {[fmtPhone(m.phone), m.email, m.company_name].filter(Boolean).join(' · ') || 'No contact info'}
                  </div>
                </div>
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 10,
                  fontWeight: 600, letterSpacing: '0.06em',
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right'
                }}>
                  {fmtDate(m.created_at)}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      <div style={{
        padding: '12px 14px',
        borderTop: '1px solid var(--v3-border)',
        background: 'var(--v3-surface-2)',
        display: 'grid',
        gridTemplateColumns: '1fr 1.4fr',
        gap: 10,
        alignItems: 'center'
      }}>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 11,
          color: 'var(--v3-text-muted)',
          lineHeight: 1.35
        }}>
          {cluster.members.length - 1} {cluster.members.length - 1 === 1 ? 'duplicate' : 'duplicates'} will be deleted. Jobs move to the kept client.
        </span>
        <motion.button
          type="button"
          whileTap={busy || disabled ? undefined : { scale: 0.98 }}
          onClick={onCommit}
          disabled={busy || disabled}
          style={{
            padding: '11px 14px', borderRadius: 12, border: 'none',
            background: 'var(--v3-primary)',
            color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: busy || disabled ? 'wait' : 'pointer',
            boxShadow: 'var(--v3-gold-glow)',
            opacity: busy || disabled ? 0.7 : 1
          }}
        >
          {busy ? 'Merging…' : 'Merge cluster'}
        </motion.button>
      </div>
    </section>
  )
}
