// Review and merge duplicate customers, /clients/merge (Phase 9, Task 14,
// D57). It took the place of the merge sheet the Customers list opened.
// The clusters come from the same roster and match policy the list uses
// (lib/clientMerge.ts: phone or email, normalized); for each cluster the
// operator picks the record to keep (the oldest by default, so manual
// edits are not blown away) and merges with a second tap, since the
// duplicates are deleted. Aggregates recompute on the server, so the list
// only needs to reload its rows.
//
// Clusters link transitively (A shares a phone with B, B an email with C),
// so a member can be unticked: it is left out of the merge and remembered
// on this device as a different client from the one kept. Unticking
// everyone keeps the whole cluster apart.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ChevronLeft } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button, IconButton, SkeletonRows } from '../../components/fh'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useClientsBundle, useInvalidateClients } from '../../lib/queries.ts'
import { findDuplicateClusters, loadNotDuplicates, rememberNotDuplicates, mergeClients } from '../../lib/clientMerge.ts'
import { hapticTap, hapticMedium, hapticError } from '../../lib/haptics.ts'
import { toastSuccess, toastError } from '../../lib/toast.ts'
import { countNoun } from '../../lib/format.ts'
import { useArmedId } from '../../lib/secondTap.ts'
import './clients-merge.css'

function fmtPhone(n: any) {
  if (!n) return ''
  const digits = String(n).replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  return n
}

function fmtDate(s: any) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function oldestMemberId(cluster: any): string | undefined {
  return [...cluster.members].sort((a: any, b: any) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0
    const db = b.created_at ? new Date(b.created_at).getTime() : 0
    return da - db
  })[0]?.id
}

export default function ClientsMerge() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: bundle, isPending: loading } = useClientsBundle(user?.id)
  const invalidateClients = useInvalidateClients()
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  // Pairs the operator marked as different clients stop being flagged
  // (remembered on this device).
  const [notDuplicates, setNotDuplicates] = useState<ReadonlySet<string>>(() => loadNotDuplicates(user?.id))
  const clusters = useMemo(() => findDuplicateClusters(bundle?.clients ?? [], notDuplicates), [bundle, notDuplicates])

  const [selected, setSelected] = useState<Record<string, string>>({})
  // Members unticked per cluster key: left out of the merge, kept apart.
  const [skipped, setSkipped] = useState<Record<string, string[]>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Set<string>>(() => new Set())
  // Ids merged away here. Until the clients list refetches, the rows are
  // still in `clusters` and could show up as a new cluster.
  const [mergedAway, setMergedAway] = useState<Set<string>>(() => new Set())
  const mergeTap = useArmedId()

  // Each cluster's survivor defaults to its oldest record. Picks the
  // operator made survive a refetch of the clients list (one follows every
  // merge, another comes on window focus).
  useEffect(() => {
    setSelected((prev) => {
      const next: Record<string, string> = {}
      for (const c of clusters) {
        const kept = prev[c.key]
        const pick = kept && c.members.some((m: any) => m.id === kept) ? kept : oldestMemberId(c)
        if (pick) next[c.key] = pick
      }
      return next
    })
  }, [clusters])

  const remaining = useMemo(
    () => clusters.filter((c: any) => !resolved.has(c.key) && !c.members.some((m: any) => mergedAway.has(m.id))),
    [clusters, resolved, mergedAway]
  )

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/clients', { replace: true })
  }

  function markResolved(key: string) {
    setResolved((prev) => new Set([...prev, key]))
  }

  function pickSurvivor(cluster: any, id: string) {
    hapticTap()
    mergeTap.disarm()
    setSelected((s) => ({ ...s, [cluster.key]: id }))
    // The record you keep is never left out.
    setSkipped((s) => (s[cluster.key]?.includes(id) ? { ...s, [cluster.key]: s[cluster.key].filter((x) => x !== id) } : s))
  }

  function toggleSkipped(cluster: any, id: string) {
    hapticTap()
    mergeTap.disarm()
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
      setNotDuplicates(rememberNotDuplicates(user?.id, notDuplicates, keptApart))
      hapticMedium()
      toastSuccess('Kept as separate clients', "They won't be flagged as duplicates again on this device.")
      markResolved(cluster.key)
      return
    }

    setBusyKey(cluster.key)
    try {
      const result = await mergeClients({ userId: user?.id, survivor, losers })
      hapticMedium()
      toastSuccess(
        `Merged ${losers.length + 1} into 1`,
        result.reassigned > 0
          ? `${result.reassigned} ${countNoun(result.reassigned, 'job')} reassigned`
          : 'No jobs needed reassigning'
      )
      if (keptApart.length > 0) setNotDuplicates(rememberNotDuplicates(user?.id, notDuplicates, keptApart))
      setMergedAway((prev) => new Set([...prev, ...losers.map((m: any) => m.id)]))
      markResolved(cluster.key)
      void invalidateClients()
    } catch (err: any) {
      hapticError()
      toastError("Couldn't merge", err?.message || 'Unknown error')
    } finally {
      setBusyKey(null)
    }
  }

  // A merge deletes records, so it takes a second tap; keeping records
  // apart deletes nothing and runs on the first.
  function onCommit(cluster: any, toDelete: number) {
    if (toDelete > 0) mergeTap.tap(cluster.key, () => { void commitMerge(cluster) })
    else void commitMerge(cluster)
  }

  return (
    <div className="fhcm">
      <header className="fhcm-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhcm-title" ref={titleRef} tabIndex={-1}>Merge duplicates</h1>
      </header>
      <p className="fhcm-lede">
        {loading ? 'Looking for duplicates.' : remaining.length === 0 ? 'All clean.' : `${remaining.length} ${remaining.length === 1 ? 'cluster' : 'clusters'} to review. Tap the record to keep. Untick anyone who is a different client and they stay separate.`}
      </p>

      <div className="fhcm-body">
        {loading && <SkeletonRows rows={3} label="Looking for duplicates" />}
        {!loading && remaining.length === 0 && (
          <p className="fhcm-empty">No duplicate clusters left. Nice cleanup.</p>
        )}
        {remaining.map((cluster: any) => {
          const survivorId = selected[cluster.key]
          const skippedIds = skipped[cluster.key] || []
          const matchedOn = cluster.matchedOn?.length ? cluster.matchedOn.join(' and ') : 'phone or email'
          const others = cluster.members.length - 1
          const keptApart = cluster.members.filter((m: any) => m.id !== survivorId && skippedIds.includes(m.id)).length
          const toDelete = others - keptApart
          const busy = busyKey === cluster.key
          const disabled = !!busyKey && busyKey !== cluster.key
          const armed = mergeTap.armedId === cluster.key
          return (
            <section key={cluster.key} className="fhcm-cluster" aria-label={`${cluster.members.length} duplicates matched on ${matchedOn}`}>
              <header className="fhcm-cluster__head">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{cluster.members.length} duplicates, matched on {matchedOn}</span>
              </header>
              <ul className="fhcm-members">
                {cluster.members.map((m: any) => {
                  const isSurvivor = m.id === survivorId
                  const isSkipped = !isSurvivor && skippedIds.includes(m.id)
                  return (
                    <li key={m.id} className={`fhcm-member${isSurvivor ? ' is-kept' : ''}${isSkipped ? ' is-skipped' : ''}`}>
                      <button
                        type="button"
                        className="fhcm-member__pick"
                        onClick={() => pickSurvivor(cluster, m.id)}
                        disabled={busy || disabled}
                        aria-pressed={isSurvivor}
                      >
                        <span className="fhcm-member__mark" aria-hidden="true">
                          {isSurvivor && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="fhcm-member__text">
                          <span className="fhcm-member__name">
                            {m.name || 'Unnamed'}
                            {isSurvivor && <span className="fhcm-member__tag">Keep</span>}
                            {isSkipped && <span className="fhcm-member__tag">Separate</span>}
                          </span>
                          <span className="fhcm-member__meta">
                            {[fmtPhone(m.phone), m.email, m.company_name].filter(Boolean).join(', ') || 'No contact info'}
                          </span>
                        </span>
                        <span className="fhcm-member__date">{fmtDate(m.created_at)}</span>
                      </button>
                      {/* Ticked members merge into the kept record; unticking
                          one marks it as a different client. The kept record
                          has no box. */}
                      {isSurvivor ? (
                        <span className="fhcm-member__box" aria-hidden="true" />
                      ) : (
                        <label className="fhcm-member__box">
                          <Checkbox
                            checked={!isSkipped}
                            onCheckedChange={() => toggleSkipped(cluster, m.id)}
                            disabled={busy || disabled}
                            aria-label={`Merge ${m.name || 'this client'} into the record you keep`}
                          />
                        </label>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="fhcm-cluster__foot">
                <span className="fhcm-cluster__note">
                  {toDelete > 0
                    ? `${toDelete} ${toDelete === 1 ? 'duplicate' : 'duplicates'} will be deleted. Jobs and notes move to the kept client.${keptApart > 0 ? ` ${keptApart} ${keptApart === 1 ? 'stays' : 'stay'} separate.` : ''}`
                    : "Nothing will be deleted. These stay separate and won't be flagged again on this device."}
                </span>
                <Button
                  variant={toDelete > 0 ? 'destructive' : 'secondary'}
                  size="md"
                  onClick={() => onCommit(cluster, toDelete)}
                  loading={busy}
                  disabled={disabled}
                >
                  {toDelete > 0 ? (armed ? 'Tap again to merge' : 'Merge cluster') : 'Keep separate'}
                </Button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
