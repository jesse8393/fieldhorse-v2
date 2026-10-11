import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Plus, Receipt } from 'lucide-react'
import { Button, Chip, EmptyState, Icon, Row, SkeletonRows } from '../../../components/fh'
import { formatMoney } from '../../../components/fh/money.ts'
import { Switch } from '@/components/ui/switch'
import { hapticTap } from '../../../lib/haptics.ts'
import { buildQuoteView, depositScheduleFromTerms, previewAsLabel, previewAsName } from '../../../lib/quoteView.ts'
import { useItemSuggestions, useQuoteItems } from '../sections/QuoteItems.tsx'
import { shortDate, statusChip } from '../lib/quoteStatus.ts'
import JobActionCapsule from './JobActionCapsule.tsx'
import QuotePreviewSheet from './QuotePreviewSheet.tsx'
import { QuoteLineSheet, QuoteMoreSheet, QuoteTermsSheet } from './QuoteSheets.tsx'
import './quote-phone.css'

// The Quote tab on a phone (spec 9.6, decision D8, render glamor/g-quote.jpg).
//
// Status chip and the line under it, then the lines as hairline rows (tap
// one to edit it in a sheet), "Add a line", the optional items in a paper
// panel with a switch each, and the rows that keep the rest reachable:
// scope and terms, approving by hand, sharing and downloading. The onyx
// capsule at the bottom carries the total, the deposit and the one gold
// "Send for approval".
//
// The money comes from lib/quoteView.ts. There is no overhead line: the
// deposit is the first step of the payment schedule (50 percent unless the
// quote's payment terms name another). Lines save through the same
// useQuoteItems writes the desktop builder uses. "Preview as" draws the
// proposal in the app and never mints a link or calls a send route.
//
// There is no AI draft note: nothing on the quote says it was drafted by
// the model, so the screen never claims it was.

export type QuotePhoneProps = {
  contact: any
  userId: string | undefined
  company: any
  insurance?: any
  changeOrders?: any[]
  /** deriveStatus(contact, pastQuote): label, tone and the short line. */
  status: { label: string; tone: string; sub: string | null }
  pastQuote: boolean
  /** The Quote tab's busy flag: preview, download, send, share, esign or null. */
  busy: string | null
  hasClientEmail: boolean
  clearing: boolean
  patch: (updates: Record<string, any>) => Promise<{ error?: unknown } | undefined> | undefined
  onContactRefresh: () => void
  /** With an email: builds the PDF, uploads it and emails the customer. */
  onSend: () => void
  /** Without one: mints a share link and copies it. */
  onShare: () => void
  onOpenPdf: () => void
  onDownload: () => void
  onEsign: () => void
  onOpenApprove: () => void
  onClearDraft: () => void
}

type LineSheetState = { key: number; id: string | null }

export default function QuotePhone({
  contact,
  userId,
  company,
  insurance = null,
  changeOrders = [],
  status,
  pastQuote,
  busy,
  hasClientEmail,
  clearing,
  patch,
  onContactRefresh,
  onSend,
  onShare,
  onOpenPdf,
  onDownload,
  onEsign,
  onOpenApprove,
  onClearDraft
}: QuotePhoneProps) {
  const { rows, loading, addItem, updateItem, removeItem, reorderItem } = useQuoteItems({
    jobId: contact?.id,
    userId,
    onContactRefresh
  })
  const suggestions = useItemSuggestions(userId)

  // Optional switches flip here at once (is_optional by line id), then save
  // through updateItem. An entry leaves when the saved row catches up, or
  // when the save fails. `toggled` remembers the lines a switch moved, so
  // they stay in the optional panel (and can flip back) for this visit.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setOptimistic((prev) => {
      let next = prev
      for (const id of Object.keys(prev)) {
        const saved = rows.find((r) => r.id === id)
        if (!saved || Boolean(saved.is_optional) === prev[id]) {
          if (next === prev) next = { ...prev }
          delete next[id]
        }
      }
      return next
    })
  }, [rows])

  const effective = useMemo(
    () => rows.map((r) => (r.id in optimistic ? { ...r, is_optional: optimistic[r.id] } : r)),
    [rows, optimistic]
  )
  const schedule = useMemo(() => depositScheduleFromTerms(contact?.terms_text) ?? undefined, [contact?.terms_text])
  const live = useMemo(() => buildQuoteView(effective, schedule), [effective, schedule])
  // Until the lines load, the contact's own total (kept in step with the
  // lines by the database) stands in, so the capsule does not flash $0.00.
  const placeholder = useMemo(
    () => buildQuoteView([{ id: 'total', description: 'Total', qty: 1, rate: contact?.amount ?? 0, amount: contact?.amount ?? 0 }], schedule),
    [contact?.amount, schedule]
  )
  const view = loading ? placeholder : live

  const byId = useMemo(
    () => new Map([...live.lines, ...live.optional, ...live.excluded].map((l) => [l.id, l])),
    [live]
  )
  const pending = (id: string) => Boolean(rows.find((r) => r.id === id)?._pending)
  const lines = live.lines.filter((l) => !toggled.has(l.id))
  const optionalRows = effective.filter((r) => !r.is_excluded && (r.is_optional || toggled.has(r.id)))
  const who = previewAsName(contact?.name)
  const approved = status.label === 'Approved'
  const changesRequested = status.label === 'Changes requested'
  const deletable = !approved && !(status.label === 'Draft' && rows.length === 0)

  function toggleOptional(id: string, include: boolean) {
    hapticTap()
    setToggled((s) => new Set(s).add(id))
    setOptimistic((o) => ({ ...o, [id]: !include }))
    void updateItem(id, { is_optional: !include }).then((ok) => {
      if (ok) return
      setOptimistic((o) => {
        const { [id]: _gone, ...rest } = o
        return rest
      })
    })
  }

  // Sheets. The line sheet and the terms sheet remount on every opening
  // (a new key), so each starts from what is saved.
  const [lineSheet, setLineSheet] = useState<LineSheetState | null>(null)
  const [lineOpen, setLineOpen] = useState(false)
  const [termsKey, setTermsKey] = useState(0)
  const [termsOpen, setTermsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const sheetKey = useRef(0)
  const lastSection = useRef('')

  function openLine(id: string | null) {
    hapticTap()
    sheetKey.current += 1
    setLineSheet({ key: sheetKey.current, id })
    setLineOpen(true)
  }
  const editRow = lineSheet?.id ? effective.find((r) => r.id === lineSheet.id) ?? null : null
  const editIndex = editRow ? rows.findIndex((r) => r.id === editRow.id) : -1
  const editPending = editRow ? pending(editRow.id) : false

  async function saveLine(values: any) {
    if (!lineSheet) return false
    if (!lineSheet.id) {
      lastSection.current = values.section || ''
      void addItem(values)
      return true
    }
    const id = lineSheet.id
    const ok = await updateItem(id, values)
    if (ok) {
      // The sheet's mode picker decides now; drop any switch memory.
      setToggled((s) => { const next = new Set(s); next.delete(id); return next })
      setOptimistic((o) => { const { [id]: _gone, ...rest } = o; return rest })
    }
    return ok
  }

  // The send button: the email path with an address, the link path without.
  const sendLabel = approved ? 'Send again' : 'Send for approval'
  const sendHint = !loading && !view.canSend
    ? 'Add at least one line'
    : !hasClientEmail ? 'Copies a link' : undefined
  const chip = statusChip(status)
  const terms = [
    contact?.scope_text && 'Scope',
    contact?.exclusions_text && 'Exclusions',
    contact?.terms_text && 'Payment terms',
    contact?.quote_expires_at && `Expires ${shortDate(contact.quote_expires_at)}`
  ].filter(Boolean) as string[]
  const chevron = <Icon icon={ChevronRight} size={18} className="fhq-chevron" />

  return (
    <div className="fhq-page">
      <header className="fhq-head">
        <div className="fhq-head__row">
          <h2 className="fhq-head__title">Quote</h2>
          <Chip tone={chip.tone} label={chip.label} />
          <Button
            variant="quiet"
            size="mini"
            className="fhq-head__preview"
            onClick={() => { hapticTap(); setPreviewOpen(true) }}
          >
            {previewAsLabel(contact?.name)}
          </Button>
        </div>
        {status.sub && <p className="fhq-head__sub">{status.sub}</p>}
        {!hasClientEmail && !approved && (
          <p className="fhq-head__sub">
            No email on file for {who}. Send for approval copies a link you can text or paste.
          </p>
        )}
      </header>

      {changesRequested && (
        <section className="fhq-panel" aria-labelledby="fhq-changes-title">
          <h3 className="fhq-panel__title" id="fhq-changes-title">Customer requested changes</h3>
          <p className="fhq-panel__body">
            {contact?.quote_change_request_note || 'Review the customer feedback before sending a revised quote.'}
          </p>
          <p className="fhq-panel__note">
            Update the quote, then send it again. Approval stays paused until the revision is sent.
          </p>
        </section>
      )}

      {loading ? (
        <div className="fhq-loading"><SkeletonRows rows={4} label="Loading the quote lines" /></div>
      ) : lines.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No lines yet."
          action={<Button variant="secondary" icon={Plus} onClick={() => openLine(null)}>Add a line</Button>}
        />
      ) : (
        <>
          <ul className="fhq-lines" aria-label="Line items">
            {lines.map((line) => (
              <Row
                key={line.id}
                as="li"
                title={line.title}
                subline={line.detail || undefined}
                money={line.amount}
                next={pending(line.id) ? 'Saving' : undefined}
                disabled={pending(line.id)}
                onClick={() => openLine(line.id)}
              />
            ))}
          </ul>
          <Button variant="quiet" icon={Plus} className="fhq-add" onClick={() => openLine(null)}>Add a line</Button>
        </>
      )}

      {optionalRows.length > 0 && (
        <section className="fhq-optional" aria-labelledby="fhq-optional-title">
          <h3 className="fhq-optional__title" id="fhq-optional-title">Optional for {who}</h3>
          <ul className="fhq-optional__list">
            {optionalRows.map((r) => {
              const line = byId.get(r.id)
              if (!line) return null
              const included = !r.is_optional
              const showDetail = line.detail && line.detail !== formatMoney(line.amount)
              return (
                <li className="fhq-opt" key={r.id}>
                  <button type="button" className="fhq-opt__main" onClick={() => openLine(r.id)} disabled={pending(r.id)}>
                    <span className="fhq-opt__title">{line.title}</span>
                    {showDetail && <span className="fhq-opt__sub">{line.detail}</span>}
                    <span className="fhq-opt__sub">Adds {formatMoney(line.amount)}</span>
                  </button>
                  <Switch
                    className="fhq-switch"
                    checked={included}
                    disabled={pending(r.id)}
                    aria-label={`Include ${line.title} in the total`}
                    onCheckedChange={(on: boolean) => toggleOptional(r.id, on)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {live.excluded.length > 0 && (
        <section className="fhq-excluded" aria-labelledby="fhq-excluded-title">
          <h3 className="fhq-excluded__title" id="fhq-excluded-title">Not included</h3>
          <ul className="fhq-lines" aria-label="Lines that are not included">
            {live.excluded.map((line) => (
              <Row
                key={line.id}
                as="li"
                title={line.title}
                subline={line.detail || undefined}
                money={line.amount}
                onClick={() => openLine(line.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {approved && (
        <section className="fhq-panel" aria-labelledby="fhq-approved-title">
          <h3 className="fhq-panel__title" id="fhq-approved-title">Quote approved</h3>
          <p className="fhq-panel__body">
            {contact?.proposal_status === 'approved'
              ? `Approval saved${contact?.updated_at ? `, ${shortDate(contact.updated_at)}` : ''}. Later edits to lines, scope or terms do not change what the customer agreed to.`
              : 'This job has already moved past the quote phase, so the proposal counts as approved. Lock the snapshot to freeze the current lines, scope and terms as the official approved version.'}
          </p>
        </section>
      )}

      <ul className="fhq-rows" aria-label="More about this quote">
        <Row
          as="li"
          title="Scope and terms"
          subline={terms.length > 0 ? terms.join(', ') : 'Not added yet'}
          next={chevron}
          onClick={() => { hapticTap(); setTermsKey((k) => k + 1); setTermsOpen(true) }}
        />
        {approved ? (
          <Row
            as="li"
            title={contact?.proposal_status === 'approved' ? 'Approve a new version' : 'Lock the snapshot'}
            subline="Saves the current quote as the approved version."
            next={chevron}
            onClick={() => { hapticTap(); onOpenApprove() }}
          />
        ) : !changesRequested && (
          <Row
            as="li"
            title="Approve quote"
            subline={live.canSend ? 'Record that the customer said yes.' : 'Add at least one line first.'}
            next={chevron}
            disabled={!live.canSend || busy !== null}
            onClick={() => { hapticTap(); onOpenApprove() }}
          />
        )}
        <Row
          as="li"
          title="Share or download"
          subline="PDF, share link, electronic signature"
          next={chevron}
          onClick={() => { hapticTap(); setMoreOpen(true) }}
        />
      </ul>

      {deletable ? (
        <div className="fhq-danger">
          <Button variant="destructive" disabled={clearing} onClick={onClearDraft}>Delete draft quote</Button>
        </div>
      ) : approved ? (
        <p className="fhq-danger-note">Approved quotes cannot be deleted. Create a revision instead.</p>
      ) : null}

      <JobActionCapsule
        variant="total"
        total={{
          amount: formatMoney(view.baseTotal),
          note: `Deposit ${formatMoney(view.deposit.amount)} at approval`
        }}
        action={{
          label: sendLabel,
          onClick: hasClientEmail ? onSend : onShare,
          disabled: loading || !view.canSend || busy !== null,
          loading: busy === 'send' || busy === 'share',
          hint: sendHint
        }}
      />

      {lineSheet && (
        <QuoteLineSheet
          key={lineSheet.key}
          open={lineOpen}
          onOpenChange={setLineOpen}
          row={editRow}
          defaultSection={lastSection.current}
          suggestions={suggestions}
          onSave={saveLine}
          onDelete={editRow ? () => { setLineOpen(false); void removeItem(editRow.id) } : undefined}
          onMove={editRow ? (direction) => { void reorderItem(editRow.id, direction) } : undefined}
          canMoveUp={editIndex > 0 && !editPending}
          canMoveDown={editIndex >= 0 && editIndex < rows.length - 1 && !editPending}
        />
      )}
      {termsKey > 0 && (
        <QuoteTermsSheet key={termsKey} open={termsOpen} onOpenChange={setTermsOpen} contact={contact} patch={patch} />
      )}
      <QuoteMoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        email={String(contact?.email || '').trim()}
        busy={busy !== null}
        onOpenPdf={onOpenPdf}
        onDownload={onDownload}
        onShare={onShare}
        onEsign={onEsign}
      />
      <QuotePreviewSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        who={who}
        company={company}
        contact={contact}
        items={effective}
        userId={userId}
        insurance={insurance}
        changeOrders={changeOrders}
      />
    </div>
  )
}

