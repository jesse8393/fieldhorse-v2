// src/components/MergeDuplicatesSheet.tsx
//
// Review-and-merge sheet for duplicate clients. Receives pre-detected
// clusters from Clients.jsx; for each cluster the user picks a survivor
// (defaults to the oldest record so manual edits aren't blown away) and
// commits the merge. Aggregates recompute on the server via trigger so
// the parent screen only needs to reload its rows.
//
// Each cluster is committed independently, partial merges are fine.
// Clusters link transitively (A shares a phone with B, B an email with
// C), so a member can be unticked: it is left out of the merge and
// reported through onMarkedDistinct as a different client from the one
// kept. Unticking everyone keeps the whole cluster apart.
// The sheet keeps itself open until every cluster is resolved or the
// user closes manually.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Checkbox } from '@/components/ui/checkbox'
import { Users, Check, AlertTriangle, X } from 'lucide-react'
import { hapticTap, hapticMedium, hapticError } from '../lib/haptics.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { mergeClients } from '../lib/clientMerge.ts'
import { countNoun } from '../lib/format.ts'
import { Eyebrow } from './v3'

function fmtPhone(n: any) {
  if (!n) return ''
  const digits = String(n).replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return n
}

function fmtDate(s: any) {
  if (!s) return '\u2003'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '\u2003'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function oldestMemberId(cluster: any): string | undefined {
  return [...cluster.members].sort((a: any, b: any) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0
    const db = b.created_at ? new Date(b.created_at).getTime() : 0
    return da - db
  })[0]?.id
}

export default function MergeDuplicatesSheet({ open, userId, clusters, onClose, onMerged, onMarkedDistinct }: any) {
  const [selected, setSelected] = useState<Record<string, string>>({})
  // Members unticked per cluster key: left out of the merge, kept apart.
  const [skipped, setSkipped] = useState<Record<string, string[]>>({})
  const [busyKey, setBusyKey] = useState<any>(null)
  const [resolved, setResolved] = useState(() => new Set())
  // Ids merged away this session. Until the clients list refetches, the
  // rows are still in `clusters` and could show up as a new cluster.
  const [mergedAway, setMergedAway] = useState<Set<string>>(() => new Set())
  const wasOpen = useRef(false)

  // Each cluster's survivor defaults to its oldest record. Picks the
  // operator made survive a refetch of the clients list (one follows every
  // merge, another comes on window focus): resetting them here swapped a
  // chosen survivor back to the oldest record, so the next tap deleted the
  // record they meant to keep. The rest resets only when the sheet opens.
  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    const opening = !wasOpen.current
    wasOpen.current = true
    setSelected((prev) => {
      const next: Record<string, string> = {}
      for (const c of clusters || []) {
        const kept = opening ? undefined : prev[c.key]
        const pick = kept && c.members.some((m: any) => m.id === kept) ? kept : oldestMemberId(c)
        if (pick) next[c.key] = pick
      }
      return next
    })
    if (opening) {
      setSkipped({})
      setResolved(new Set())
      setMergedAway(new Set())
      setBusyKey(null)
    }
  }, [open, clusters])

  const remaining = useMemo(
    () => (clusters || []).filter((c: any) =>
      !resolved.has(c.key) && !c.members.some((m: any) => mergedAway.has(m.id))
    ),
    [clusters, resolved, mergedAway]
  )

  function markResolved(key: string) {
    setResolved((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  function pickSurvivor(cluster: any, id: string) {
    hapticTap()
    setSelected((s) => ({ ...s, [cluster.key]: id }))
    // The record you keep is never left out.
    setSkipped((s) => (s[cluster.key]?.includes(id) ? { ...s, [cluster.key]: s[cluster.key].filter((x) => x !== id) } : s))
  }

  function toggleSkipped(cluster: any, id: string) {
    hapticTap()
    setSkipped((s) => {
      const current = s[cluster.key] || []
      return { ...s, [cluster.key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] }
    })
  }

  async function commitMerge(cluster: any) {
    const survivorId = selected[cluster.key]
    const survivor = cluster.members.find((m: any) => m.id === survivorId)
    if (!survivor) {
      hapticError()
      toastError('Pick a survivor', 'Tap the client to keep.')
      return
    }
    const skippedIds = new Set(skipped[cluster.key] || [])
    const others = cluster.members.filter((m: any) => m.id !== survivor.id)
    const losers = others.filter((m: any) => !skippedIds.has(m.id))
    const keptApart: Array<[string, string]> = others
      .filter((m: any) => skippedIds.has(m.id))
      .map((m: any) => [survivor.id, m.id])

    if (losers.length === 0) {
      if (keptApart.length === 0) return
      onMarkedDistinct?.(keptApart)
      hapticMedium()
      toastSuccess('Kept as separate clients', "They won't be flagged as duplicates again on this device.")
      markResolved(cluster.key)
      return
    }

    setBusyKey(cluster.key)
    try {
      const result = await mergeClients({ userId, survivor, losers })
      hapticMedium()
      toastSuccess(
        `Merged ${losers.length + 1} into 1`,
        result.reassigned > 0
          ? `${result.reassigned} ${countNoun(result.reassigned, 'job')} reassigned`
          : 'No jobs needed reassigning'
      )
      if (keptApart.length > 0) onMarkedDistinct?.(keptApart)
      setMergedAway((prev) => new Set([...prev, ...losers.map((m: any) => m.id)]))
      markResolved(cluster.key)
      onMerged?.()
    } catch (err: any) {
      hapticError()
      toastError("Couldn't merge", err?.message || 'Unknown error')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v: any) => { if (!v && !busyKey) onClose?.() }}>
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
          padding: '12px 24px 12px',
          borderBottom: '1px solid var(--v3-border)',
          background: 'var(--v3-surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span aria-hidden="true" style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'var(--v3-glass-tint-2)',
              border: '1px solid var(--v3-border-strong)',
              color: 'var(--ink-strong)',
              display: 'grid', placeItems: 'center'
            }}>
              <Users size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <DrawerTitle style={{
                margin: 0, fontFamily: 'var(--font-display)', fontSize: 20,
                color: 'var(--v3-text)', letterSpacing: 0
              }}>
                Merge duplicates
              </DrawerTitle>
              <DrawerDescription style={{
                margin: '2px 0 0', fontFamily: 'var(--font-body)', fontSize: 12,
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
          padding: '12px 24px 24px',
          display: 'flex', flexDirection: 'column', gap: 12
        }}>
          {remaining.length === 0 && (
            <div style={{
              padding: '24px 24px', borderRadius: 10,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border-strong)',
              textAlign: 'center', color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', fontSize: 14
            }}>
              No duplicate clusters left. Nice cleanup.
            </div>
          )}
          {remaining.length > 0 && (
            <p style={{
              margin: 0, fontFamily: 'var(--font-body)', fontSize: 12,
              color: 'var(--v3-text-muted)', lineHeight: 1.45
            }}>
              Tap the record to keep. Untick anyone who is a different client and they stay separate.
            </p>
          )}
          {remaining.map((cluster: any) => (
            <ClusterCard
              key={cluster.key}
              cluster={cluster}
              survivorId={selected[cluster.key]}
              skippedIds={skipped[cluster.key] || []}
              onPick={(id: string) => pickSurvivor(cluster, id)}
              onToggleSkip={(id: string) => toggleSkipped(cluster, id)}
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

function ClusterCard({ cluster, survivorId, skippedIds, onPick, onToggleSkip, onCommit, busy, disabled }: any) {
  const matchedOn = cluster.matchedOn?.length ? cluster.matchedOn.join(' & ') : 'phone/email'
  const others = cluster.members.length - 1
  const keptApart = cluster.members.filter((m: any) => m.id !== survivorId && skippedIds.includes(m.id)).length
  const toDelete = others - keptApart
  return (
    <section style={{
      borderRadius: 10,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border-strong)',
      boxShadow: 'inset 0 1px 0 var(--v3-glass-tint), 0 2px 8px rgba(20, 20, 20, 0.25)',
      overflow: 'hidden'
    }}>
      <header style={{
        padding: '12px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--v3-border)',
        background: 'var(--v3-surface-2)'
      }}>
        <AlertTriangle size={13} aria-hidden="true" style={{ color: 'var(--ink-strong)' }} />
        <Eyebrow style={{ color: 'var(--ink-strong)' }}>
          {cluster.members.length} duplicates · matched on {matchedOn}
        </Eyebrow>
      </header>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {cluster.members.map((m: any, i: any) => {
          const isSurvivor = m.id === survivorId
          const isSkipped = !isSurvivor && skippedIds.includes(m.id)
          return (
            <li key={m.id} style={{
              display: 'flex',
              alignItems: 'stretch',
              borderTop: i === 0 ? 'none' : '1px solid var(--v3-border)',
              background: isSurvivor ? 'color-mix(in srgb, var(--v3-primary) 8%, transparent)' : 'transparent'
            }}>
              <button
                type="button"
                onClick={() => onPick(m.id)}
                disabled={busy || disabled}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 12px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  color: 'inherit',
                  cursor: busy || disabled ? 'wait' : 'pointer',
                  opacity: isSkipped ? 0.55 : 1,
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <span aria-hidden="true" style={{
                  width: 18, height: 18, borderRadius: 10,
                  border: `2px solid ${isSurvivor ? 'var(--ink-strong)' : 'var(--v3-border-strong)'}`,
                  background: isSurvivor ? 'var(--ink-strong)' : 'transparent',
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
                      <Eyebrow style={{ marginLeft: 8, color: 'var(--ink-strong)' }}>
                        Keep
                      </Eyebrow>
                    )}
                    {isSkipped && (
                      <Eyebrow style={{ marginLeft: 8 }}>
                        Separate
                      </Eyebrow>
                    )}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: 'var(--v3-text-muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {[fmtPhone(m.phone), m.email, m.company_name].filter(Boolean).join(' · ') || 'No contact info'}
                  </div>
                </div>
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 12,
                  fontWeight: 600, letterSpacing: 0,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right'
                }}>
                  {fmtDate(m.created_at)}
                </div>
              </button>
              {/* Ticked members merge into the kept record; unticking one
                  marks it as a different client. The kept record has no box.
                  The label widens the tap target around the small box. */}
              {isSurvivor ? (
                <span aria-hidden="true" style={{ flexShrink: 0, width: 48 }} />
              ) : (
                <label style={{
                  flexShrink: 0,
                  width: 48,
                  display: 'grid', placeItems: 'center',
                  cursor: busy || disabled ? 'wait' : 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}>
                  <Checkbox
                    checked={!isSkipped}
                    onCheckedChange={() => onToggleSkip(m.id)}
                    disabled={busy || disabled}
                    aria-label={`Merge ${m.name || 'this client'} into the record you keep`}
                  />
                </label>
              )}
            </li>
          )
        })}
      </ul>
      <div style={{
        padding: '12px 12px',
        borderTop: '1px solid var(--v3-border)',
        background: 'var(--v3-surface-2)',
        display: 'grid',
        gridTemplateColumns: '1fr 1.4fr',
        gap: 12,
        alignItems: 'center'
      }}>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 12,
          color: 'var(--v3-text-muted)',
          lineHeight: 1.35
        }}>
          {toDelete > 0
            ? `${toDelete} ${toDelete === 1 ? 'duplicate' : 'duplicates'} will be deleted. Jobs and notes move to the kept client.${keptApart > 0 ? ` ${keptApart} ${keptApart === 1 ? 'stays' : 'stay'} separate.` : ''}`
            : "Nothing will be deleted. These stay separate and won't be flagged again on this device."}
        </span>
        <motion.button
          type="button"
          whileTap={busy || disabled ? undefined : { scale: 0.98 }}
          onClick={onCommit}
          disabled={busy || disabled}
          style={{
            padding: '12px 12px', borderRadius: 10, border: 'none',
            background: 'var(--v3-primary)',
            color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: 0,
            cursor: busy || disabled ? 'wait' : 'pointer',
            boxShadow: 'var(--v3-gold-glow)',
            opacity: busy || disabled ? 0.7 : 1
          }}
        >
          {busy ? 'Merging…' : toDelete > 0 ? 'Merge cluster' : 'Keep separate'}
        </motion.button>
      </div>
    </section>
  )
}
