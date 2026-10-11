import { useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  Bell,
  Camera,
  ChevronLeft,
  Cloud,
  Ellipsis,
  HardHat,
  Images,
  Mic,
  Plus,
  Search,
  SlidersHorizontal
} from 'lucide-react'
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Icon,
  IconButton,
  KeyCap,
  OnyxStage,
  PhotoCard,
  Row,
  Sheet,
  Skeleton,
  SkeletonRows,
  SpineEntry,
  StageRail,
  SyncPill,
  VaultCard,
  useSheet
} from '../components/fh/index.ts'

// Development only (/design, registered in App.tsx under import.meta.env.DEV).
// Every redesign component in every state, Day on the left and Night on the
// right (stacked on a phone). The Night column is a div with
// data-theme="dark", so it proves the components read only --fh- tokens.

type Theme = 'day' | 'night'

/* ------------------------------------------------------------------
   Sample photos. Production photos are the contractor's own (spec 11);
   this sheet has none, so it paints stand in frames from the brand
   tokens on a canvas: dusk over slab forms, rebar, a finished slab.
   ------------------------------------------------------------------ */

type SampleKind = 'forms' | 'rebar' | 'finished'
type SamplePhotos = Record<SampleKind, string>

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((d) => d + d).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function paintSample(kind: SampleKind): string | null {
  const W = 960
  const H = 640
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const css = getComputedStyle(document.documentElement)
  const t = (name: string) => css.getPropertyValue(name).trim()
  const onyx = t('--fh-onyx')
  const onyx2 = t('--fh-onyx-2')
  const line = t('--fh-onyx-line')
  const gold = t('--fh-gold')
  const hi = t('--fh-gold-hi')
  const lo = t('--fh-gold-lo')
  const linen = t('--fh-linen')
  const smoke = t('--fh-smoke')
  if (!onyx || !gold) return null

  let seed = kind === 'forms' ? 11 : kind === 'rebar' ? 23 : 37
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const horizon = H * (kind === 'rebar' ? 0.26 : 0.44)
  const sunX = W * (kind === 'finished' ? 0.18 : 0.78)
  const sunY = horizon - 24

  // Sky, warm at the horizon.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, line)
  sky.addColorStop(0.55, lo)
  sky.addColorStop(1, hi)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, horizon + 4)

  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.45)
  sun.addColorStop(0, linen)
  sun.addColorStop(0.06, rgba(hi, 0.95))
  sun.addColorStop(0.35, rgba(gold, 0.35))
  sun.addColorStop(1, rgba(gold, 0))
  ctx.fillStyle = sun
  ctx.fillRect(0, 0, W, horizon + 4)

  // Tree line.
  ctx.fillStyle = onyx2
  for (let x = -20; x < W + 40; x += 10 + rand() * 18) {
    const r = 14 + rand() * 34
    ctx.globalAlpha = 0.86 + rand() * 0.14
    ctx.beginPath()
    ctx.arc(x, horizon - r * 0.55, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // A house behind the slab.
  if (kind !== 'rebar') {
    const hx = kind === 'finished' ? W * 0.46 : W * 0.12
    const hw = W * 0.36
    const top = horizon - 92
    ctx.fillStyle = onyx
    ctx.fillRect(hx, top, hw, 96)
    ctx.beginPath()
    ctx.moveTo(hx - 16, top + 2)
    ctx.lineTo(hx + hw * 0.5, top - 54)
    ctx.lineTo(hx + hw + 16, top + 2)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = line
    ctx.fillRect(hx + hw * 0.52, top + 34, hw * 0.4, 62)
    ctx.fillStyle = rgba(hi, 0.7)
    ctx.fillRect(hx + hw * 0.1, top + 30, 26, 22)
    ctx.fillRect(hx + hw * 0.28, top + 30, 26, 22)
  }

  // Ground.
  const ground = ctx.createLinearGradient(0, horizon, 0, H)
  ground.addColorStop(0, line)
  ground.addColorStop(0.35, onyx2)
  ground.addColorStop(1, onyx)
  ctx.fillStyle = ground
  ctx.fillRect(0, horizon, W, H - horizon)
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = rgba(rand() > 0.5 ? smoke : lo, 0.08 + rand() * 0.12)
    ctx.fillRect(rand() * W, horizon + rand() * (H - horizon), 2, 1)
  }

  // The slab, in perspective.
  const farY = horizon + (H - horizon) * (kind === 'rebar' ? 0.04 : 0.16)
  const nearY = H + 40
  const far = kind === 'rebar' ? [W * 0.12, W * 0.88] : [W * 0.26, W * 0.8]
  const near = [-W * 0.12, W * 1.12]
  const at = (u: number, v: number) => {
    const x0 = far[0] + (near[0] - far[0]) * v
    const x1 = far[1] + (near[1] - far[1]) * v
    return [x0 + (x1 - x0) * u, farY + (nearY - farY) * v] as const
  }
  ctx.beginPath()
  ctx.moveTo(...at(0, 0))
  ctx.lineTo(...at(1, 0))
  ctx.lineTo(...at(1, 1))
  ctx.lineTo(...at(0, 1))
  ctx.closePath()
  const slab = ctx.createLinearGradient(0, farY, 0, H)
  if (kind === 'finished') {
    slab.addColorStop(0, rgba(hi, 0.9))
    slab.addColorStop(0.3, smoke)
    slab.addColorStop(1, line)
  } else {
    slab.addColorStop(0, line)
    slab.addColorStop(1, onyx)
  }
  ctx.fillStyle = slab
  ctx.fill()

  // Rebar mat: lines along and across, closer together with distance.
  if (kind !== 'finished') {
    ctx.strokeStyle = rgba(gold, kind === 'rebar' ? 0.75 : 0.6)
    for (let i = 1; i < 16; i += 1) {
      const u = i / 16
      ctx.lineWidth = kind === 'rebar' ? 2.5 : 1.5
      ctx.beginPath()
      ctx.moveTo(...at(u, 0))
      ctx.lineTo(...at(u, 1))
      ctx.stroke()
    }
    for (let i = 1; i < 22; i += 1) {
      const v = Math.pow(i / 22, 1.7)
      ctx.lineWidth = 1 + v * 2.5
      ctx.beginPath()
      ctx.moveTo(...at(0, v))
      ctx.lineTo(...at(1, v))
      ctx.stroke()
    }
  }

  // Form boards and stakes.
  ctx.strokeStyle = lo
  ctx.lineCap = 'round'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(...at(0, 1))
  ctx.lineTo(...at(0, 0))
  ctx.lineTo(...at(1, 0))
  ctx.lineTo(...at(1, 1))
  ctx.stroke()
  for (let v = 0; v <= 1; v += 0.12) {
    for (const u of [0, 1]) {
      const [x, y] = at(u, v)
      const s = 0.5 + v * 1.4
      ctx.fillStyle = lo
      ctx.fillRect(x - 3 * s, y - 26 * s, 6 * s, 30 * s)
      ctx.fillStyle = hi
      ctx.fillRect(x - 3 * s, y - 26 * s, 6 * s, 3 * s)
    }
  }

  // Low sun across the frame, and a soft vignette.
  ctx.globalCompositeOperation = 'screen'
  const wash = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, W * 0.9)
  wash.addColorStop(0, rgba(gold, 0.32))
  wash.addColorStop(1, rgba(gold, 0))
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75)
  vignette.addColorStop(0, rgba(onyx, 0))
  vignette.addColorStop(1, rgba(onyx, 0.55))
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)

  return canvas.toDataURL('image/jpeg', 0.86)
}

function useSamplePhotos(): SamplePhotos | null {
  const [photos] = useState<SamplePhotos | null>(() => {
    if (typeof document === 'undefined') return null
    try {
      const forms = paintSample('forms')
      const rebar = paintSample('rebar')
      const finished = paintSample('finished')
      return forms && rebar && finished ? { forms, rebar, finished } : null
    } catch {
      return null
    }
  })
  return photos
}

/* The left column is Day even when the app is in Night: the sheet pins
   the page to Day while it is open and hands the theme back on leave. */
function usePinDay() {
  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute('data-theme')
    root.setAttribute('data-theme', 'light')
    return () => {
      if (previous) root.setAttribute('data-theme', previous)
      else root.removeAttribute('data-theme')
    }
  }, [])
}

/* ------------------------------------------------------------------
   Layout helpers
   ------------------------------------------------------------------ */

function Group({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="fhc-ds__group" aria-labelledby={id}>
      <div className="fhc-ds__grouphead">
        <h3 id={id} className="fhc-ds__grouptitle">{title}</h3>
        {note && <p className="fhc-ds__groupnote">{note}</p>}
      </div>
      <div className="fhc-ds__specimens">{children}</div>
    </section>
  )
}

function Spec({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'fhc-ds__spec fhc-ds__spec--wide' : 'fhc-ds__spec'}>
      <p className="fhc-ds__cap">{label}</p>
      {children}
    </div>
  )
}

function ListHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="fhc-ds__listhead">
      <span className="fhc-ds__listtitle">{title}</span>
      <span className="fhc-ds__listmeta">{meta}</span>
    </div>
  )
}

/* Cancel inside a sheet: asks first when there are unsaved changes. */
function SheetCancel() {
  const { requestClose } = useSheet()
  return (
    <Button variant="quiet" size="lg" onClick={requestClose}>
      Cancel
    </Button>
  )
}

/* ------------------------------------------------------------------
   One column of specimens
   ------------------------------------------------------------------ */

function Board({ theme, photos, sheetContainer }: { theme: Theme; photos: SamplePhotos | null; sheetContainer: HTMLElement | null }) {
  const id = (name: string) => `fhc-ds-${theme}-${name}`
  const [sheetOpen, setSheetOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('')
  const [note, setNote] = useState('')
  const dirty = amount !== '' || method !== '' || note !== ''
  const resetSheet = () => {
    setAmount('')
    setMethod('')
    setNote('')
  }

  return (
    <div className="fhc-ds__board">
      {/* ---------------- Buttons ---------------- */}
      <Group
        id={id('buttons')}
        title="Button"
        note="Hover lays a faint wash of the label color. Pressed moves down 1 px and darkens. Keyboard focus draws a 2 px ring in the focus color."
      >
        <Spec label="Primary, lg. One per screen.">
          <div className="fhc-ds__row">
            <Button variant="primary" size="lg">Create invoice</Button>
          </div>
        </Spec>
        <Spec label="Primary, md: default, loading, disabled">
          <div className="fhc-ds__row">
            <Button variant="primary">Save</Button>
            <Button variant="primary" loading>Send for approval</Button>
            <Button variant="primary" disabled>Save</Button>
          </div>
        </Spec>
        <Spec label="Secondary: default, loading, disabled">
          <div className="fhc-ds__row">
            <Button variant="secondary">Edit</Button>
            <Button variant="secondary" loading>Message</Button>
            <Button variant="secondary" disabled>Schedule</Button>
          </div>
        </Spec>
        <Spec label="Quiet: default, disabled">
          <div className="fhc-ds__row">
            <Button variant="quiet">Preview as Marco</Button>
            <Button variant="quiet" disabled>Reports</Button>
          </div>
        </Spec>
        <Spec label="Destructive, set apart: default, disabled">
          <div className="fhc-ds__row">
            <Button variant="destructive">Delete draft</Button>
            <Button variant="destructive" disabled>Delete draft</Button>
          </div>
        </Spec>
        <Spec label="Mini, 36 tall with a 44 px hit area">
          <div className="fhc-ds__row">
            <Button size="mini">Remind</Button>
            <Button size="mini">Nudge</Button>
            <Button size="mini" loading>Reply</Button>
            <Button size="mini" disabled>Close job</Button>
          </div>
        </Spec>
        <Spec label="With icons, and as a link">
          <div className="fhc-ds__row">
            <Button icon={Camera}>Add photos</Button>
            <Button to="/design" variant="quiet" trailingIcon={ArrowRight}>Open the job</Button>
          </div>
        </Spec>
        <Spec label="Full width, lg">
          <div className="fhc-ds__stack">
            <Button variant="primary" size="lg" block>Approve and pay $9,229.00</Button>
            <Button variant="secondary" size="lg" block>Ask Jesse a question first</Button>
          </div>
        </Spec>
        <Spec label="On onyx" wide>
          <OnyxStage className="fhc-ds__stage" glow hairline={false}>
            <div className="fhc-ds__stack">
              <Button variant="primary" size="lg" block>Sign in</Button>
              <Button variant="secondary" size="lg" block>Create a workspace</Button>
              <div className="fhc-ds__row">
                <Button variant="secondary" trailingIcon={ArrowRight}>Navigate</Button>
                <Button variant="quiet">Not now</Button>
                <Button variant="secondary" loading>Message</Button>
                <Button variant="secondary" disabled>Schedule</Button>
              </div>
            </div>
          </OnyxStage>
        </Spec>
      </Group>

      {/* ---------------- Icon buttons ---------------- */}
      <Group id={id('iconbuttons')} title="IconButton" note="44 or 48, round or rounded square. Every one carries an aria-label.">
        <Spec label="Plain, 48: round, square, disabled">
          <div className="fhc-ds__row">
            <IconButton aria-label="Search jobs" icon={Search} />
            <IconButton aria-label="Filter jobs" icon={SlidersHorizontal} shape="square" />
            <IconButton aria-label="Search jobs" icon={Search} disabled />
          </div>
        </Spec>
        <Spec label="On paper, 44: round, square, disabled">
          <div className="fhc-ds__row">
            <IconButton aria-label="Notifications" icon={Bell} variant="paper" size={44} />
            <IconButton aria-label="Add a line" icon={Plus} variant="paper" size={44} shape="square" />
            <IconButton aria-label="Add a line" icon={Plus} variant="paper" size={44} shape="square" disabled />
          </div>
        </Spec>
        <Spec label="On a photo: translucent onyx" wide>
          <div className="fhc-ds__photobar">
            {photos && <img src={photos.finished} alt="" className="fhc-ds__photobar-img" />}
            <IconButton aria-label="Back to jobs" icon={ChevronLeft} variant="onyx" size={44} />
            <IconButton aria-label="More actions" icon={Ellipsis} variant="onyx" size={44} />
          </div>
        </Spec>
        <Spec label="On onyx: raised discs" wide>
          <OnyxStage className="fhc-ds__stage fhc-ds__stage--tight" hairline={false}>
            <div className="fhc-ds__row">
              <IconButton aria-label="Take a photo" icon={Camera} variant="paper" />
              <IconButton aria-label="Record a voice note" icon={Mic} variant="paper" />
              <Button variant="primary" size="lg" className="fhc-ds__grow">Create invoice</Button>
            </div>
          </OnyxStage>
        </Spec>
      </Group>

      {/* ---------------- Fields ---------------- */}
      <Group id={id('fields')} title="Field" note="Label above, 16 px input, helper below. An error replaces the helper and says how to fix it.">
        <Spec label="Default, with helper">
          <Field label="Client name" defaultValue="Darnell Whitcomb" helper="As it should read on the invoice." />
        </Spec>
        <Spec label="Empty, with placeholder">
          <Field label="Job address" placeholder="2210 Ridgecrest Dr" autoComplete="street-address" />
        </Spec>
        <Spec label="Error">
          <Field
            label="Deposit"
            defaultValue="6187,50"
            inputMode="decimal"
            error="Use a period for cents, such as 6187.50."
          />
        </Spec>
        <Spec label="Disabled">
          <Field label="Invoice number" defaultValue="INV 1042" disabled helper="Set when the invoice is sent." />
        </Spec>
        <Spec label="Multiline" wide>
          <Field
            label="Site notes"
            multiline
            defaultValue="Forms and rebar in. Inspector signed off at 7:12. Truck confirmed for 7:10 tomorrow."
          />
        </Spec>
      </Group>

      {/* ---------------- Chips ---------------- */}
      <Group id={id('chips')} title="Chip" note="Every status color travels with a word. Red only for late money or failed safety.">
        <Spec label="Success">
          <div className="fhc-ds__row">
            <Chip tone="success" label="Paid Sep 30" />
            <Chip tone="success" dot label="On site 7:30" />
            <Chip tone="success" label="31.2% margin" />
          </div>
        </Spec>
        <Spec label="Info">
          <div className="fhc-ds__row">
            <Chip tone="info" label="Starts Mon" />
            <Chip tone="info" dot label="Truck 7:10" />
            <Chip tone="info" label="New" />
          </div>
        </Spec>
        <Spec label="Danger">
          <div className="fhc-ds__row">
            <Chip tone="danger" label="6 days overdue" />
            <Chip tone="danger" dot label="Inspection failed" />
          </div>
        </Spec>
        <Spec label="Neutral">
          <div className="fhc-ds__row">
            <Chip label="Draft" />
            <Chip dot label="Lead" />
            <Chip label="Sent yesterday" />
          </div>
        </Spec>
      </Group>

      {/* ---------------- Sync pill ---------------- */}
      <Group id={id('sync')} title="SyncPill" note="Reads both outboxes and the connection. The last one is live on this device.">
        <Spec label="Synced, Syncing, Offline with a count">
          <div className="fhc-ds__row">
            <SyncPill status="synced" />
            <SyncPill status="syncing" queued={2} />
            <SyncPill status="offline" queued={3} />
          </div>
        </Spec>
        <Spec label="Offline, nothing queued, and live">
          <div className="fhc-ds__row">
            <SyncPill status="offline" />
            <SyncPill />
          </div>
        </Spec>
        <Spec label="On the Today stage" wide>
          <OnyxStage className="fhc-ds__stage fhc-ds__stage--tight" hairline={false}>
            <div className="fhc-ds__row">
              <SyncPill status="synced" />
              <SyncPill status="syncing" queued={1} />
              <SyncPill status="offline" queued={3} />
            </div>
          </OnyxStage>
        </Spec>
      </Group>

      {/* ---------------- Stage rail ---------------- */}
      <Group id={id('rail')} title="StageRail" note="Done segments in ink 4, the current one gold with a bold label, the rest hairline. Invoice means the work is done and money is out.">
        <Spec label="Lead" wide><StageRail record={{ stage: 'lead' }} /></Spec>
        <Spec label="Quote" wide><StageRail record={{ stage: 'quote' }} /></Spec>
        <Spec label="Job" wide><StageRail record={{ stage: 'job', completed_at: null }} /></Spec>
        <Spec label="Invoice: a job with completed_at set" wide>
          <StageRail record={{ stage: 'job', completed_at: '2026-10-08T17:20:00Z' }} />
        </Spec>
        <Spec label="Closed" wide><StageRail record={{ stage: 'closed' }} /></Spec>
        <Spec label="Lost: no current segment, a neutral chip" wide><StageRail record={{ stage: 'lost' }} /></Spec>
        <Spec label="With notes, shown at desktop widths" wide>
          <StageRail
            record={{ stage: 'job', completed_at: null }}
            notes={{
              lead: 'Sep 23, website',
              quote: 'Approved Sep 28',
              job: 'Pour today, inspection Fri',
              invoice: '$6,187.50 balance'
            }}
          />
        </Spec>
      </Group>

      {/* ---------------- Rows ---------------- */}
      <Group id={id('rows')} title="Row" note="The whole row is one link or button, 64 px minimum. Hairlines between rows, none after the last.">
        <Spec label="Links, with a chip or a gray next step" wide>
          <div className="fhc-ds__list">
            <ListHead title="Jobs" meta="$49,875.00 in progress" />
            <Row to="/design" title="Darnell Whitcomb" subline="Garage slab, 24 x 26" money={12375} next={<Chip tone="success" label="On site 7:30" />} />
            <Row to="/design" title="Lorraine Beasley" subline="Bath retile and arched shower" money={9700} next="Walkthrough today 2:30" />
            <Row to="/design" title="Anya Kowalczyk" subline="Covered patio framing" money={27800} next={<Chip tone="info" label="Starts Mon" />} />
          </div>
        </Spec>
        <Spec label="An overdue invoice, with one mini action beside the row" wide>
          <div className="fhc-ds__list">
            <ListHead title="Overdue" meta="1 invoice" />
            <Row
              to="/design"
              title="Rosa Delgado"
              subline="Concrete steps, final"
              money={1240}
              next={<Chip tone="danger" label="6 days overdue" />}
              action={<Button size="mini">Remind</Button>}
            />
          </div>
        </Spec>
        <Spec label="Needs an answer: a dot, a title, one mini action" wide>
          <div className="fhc-ds__list">
            <Row to="/design" dot="danger" title="Delgado invoice is 6 days overdue" subline="$1,240.00, concrete steps" action={<Button size="mini">Remind</Button>} />
            <Row to="/design" dot="neutral" title="Okafor opened the quote twice" subline="$3,180.00, sent 4 days ago" action={<Button size="mini">Nudge</Button>} />
            <Row to="/design" dot="info" title="Hollis Tran asked for a fence estimate" subline="From your website, 2 hours ago" action={<Button size="mini">Reply</Button>} />
          </div>
        </Spec>
        <Spec label="As a button, and a long name that wraps">
          <div className="fhc-ds__list">
            <Row onClick={() => undefined} title="Marco Castellanos" subline="Pool deck pour, 1,100 sq ft" money={18458} next="Sent yesterday" />
            <Row onClick={() => undefined} title="Ridgeline Concrete Finishing and Flatwork" subline="Partner on Whitcomb garage slab" money={2960} next={<Chip label="Draft" />} />
          </div>
        </Spec>
        <Spec label="Loading">
          <SkeletonRows rows={3} label="Loading jobs" />
        </Spec>
        <Spec label="Empty" wide>
          <EmptyState
            icon={HardHat}
            title="No jobs yet. Bring them over from Jobber in a few minutes."
            action={<Button variant="primary" to="/import">Import from Jobber</Button>}
          />
        </Spec>
      </Group>

      {/* ---------------- Spine ---------------- */}
      <Group id={id('spine')} title="SpineEntry" note="Newest first. Green filled markers for passed and paid. Thumbnails reserve their box and load lazily.">
        <Spec label="The Whitcomb Spine" wide>
          <ol className="fhc-ds__spine">
            <SpineEntry
              as="li"
              time="7:12"
              day="today"
              dateTime="2026-10-09T07:12"
              title="Forms and rebar in, inspector signed off."
              subline="3 photos by Jesse."
              photos={photos ? [
                { src: photos.forms, alt: 'Sample image: slab forms at sunset' },
                { src: photos.rebar, alt: 'Sample image: rebar mat, close' },
                { src: photos.finished, alt: 'Sample image: finished slab by the house' }
              ] : undefined}
            />
            <SpineEntry as="li" time="6:40" day="today" dateTime="2026-10-09T06:40" title="Truck confirmed for 7:10." subline="4.5 yards, 4,000 psi with fiber." />
            <SpineEntry as="li" time="4:05" day="Wed" dateTime="2026-10-08T16:05" tone="success" title="Slab prep inspection passed." subline="Rutherford County, permit RC 26 0931." />
            <SpineEntry as="li" time="Sep 30" dateTime="2026-09-30" tone="success" title="Deposit received, $6,187.50." subline="Card, paid through the portal." />
          </ol>
        </Spec>
        <Spec label="More photos than fit" wide>
          <ol className="fhc-ds__spine">
            <SpineEntry
              as="li"
              time="5:48"
              day="Tue"
              title="Pour finished, broom texture."
              subline="5 photos by Luis."
              photos={photos ? [
                { src: photos.finished, alt: 'Sample image: finished slab by the house' },
                { src: photos.forms, alt: 'Sample image: slab forms at sunset' },
                { src: photos.rebar, alt: 'Sample image: rebar mat, close' },
                { src: photos.forms, alt: 'Sample image: slab forms at sunset' },
                { src: photos.finished, alt: 'Sample image: finished slab by the house' }
              ] : undefined}
            />
          </ol>
        </Spec>
      </Group>

      {/* ---------------- Onyx stage ---------------- */}
      <Group id={id('stage')} title="OnyxStage" note="The one dark band per screen: grain, an optional warm glow, a gold hairline at the bottom.">
        <Spec label="Today, with the next stop overlapping the edge" wide>
          <div className="fhc-ds-today">
            <OnyxStage glow className="fhc-ds-today__stage">
              <div className="fhc-ds-today__top">
                <span className="fhc-ds-today__company">Parker Construction</span>
                <SyncPill status="synced" />
                <IconButton aria-label="Notifications" icon={Bell} size={44} />
              </div>
              <p className="fhc-ds-today__date">Thursday, October 9</p>
              <p className="fhc-ds-today__hero">Three stops.<br />First pour at 7:30.</p>
              <p className="fhc-ds-today__weather">
                <Icon icon={Cloud} size={22} />
                <span>71° and partly cloudy. Pour window is good until 3 pm.</span>
              </p>
            </OnyxStage>
            <div className="fhc-ds-today__card">
              {photos ? (
                <PhotoCard
                  src={photos.forms}
                  alt="Sample image: slab forms and rebar at sunset"
                  eyebrow="Next stop, 7:30 am"
                  title="Whitcomb garage slab"
                  titleAs="p"
                  action={<Button variant="secondary" size="mini" trailingIcon={ArrowRight}>Navigate</Button>}
                />
              ) : (
                <PhotoCard eyebrow="Next stop, 7:30 am" title="Whitcomb garage slab" titleAs="p" />
              )}
            </div>
          </div>
        </Spec>
        <Spec label="No glow, a clear day" wide>
          <OnyxStage className="fhc-ds-today__stage">
            <p className="fhc-ds-today__date">Saturday, October 11</p>
            <p className="fhc-ds-today__hero">Clear day.</p>
            <p className="fhc-ds-today__weather"><span>Nothing on the schedule.</span></p>
          </OnyxStage>
        </Spec>
      </Group>

      {/* ---------------- Photo card ---------------- */}
      <Group id={id('photo')} title="PhotoCard" note="A paper tray around the photo, linen text on the scrim. With no photo it falls back to the onyx stage.">
        <Spec label="With a photo and an action">
          {photos ? (
            <PhotoCard
              src={photos.finished}
              alt="Sample image: finished slab by the house"
              eyebrow="Darnell Whitcomb, 2210 Ridgecrest Dr"
              title="Whitcomb garage slab"
              titleAs="p"
              action={<Button size="mini" variant="secondary" icon={Images}>14 photos</Button>}
            />
          ) : (
            <Skeleton shape="block" height={200} />
          )}
        </Spec>
        <Spec label="No photo yet">
          <PhotoCard
            eyebrow="Next stop, 9:00 am"
            title="Beasley bath retile"
            titleAs="p"
            action={<Button variant="secondary" trailingIcon={ArrowRight}>Navigate</Button>}
          />
        </Spec>
        <Spec label="Loading">
          <div className="fhc-ds__tray">
            <div className="fhc-ds__frame-loading fh-onyx-scope">
              <Skeleton width="44%" height={12} />
              <Skeleton width="68%" height={20} />
            </div>
          </div>
        </Spec>
      </Group>

      {/* ---------------- Vault card ---------------- */}
      <Group id={id('vault')} title="VaultCard" note="Money always shows cents. Facts in columns on Money, in rows on the desktop facts panel.">
        <Spec label="Money, facts in columns" wide>
          <VaultCard
            label="Collected this week"
            amount={9620}
            corner={<span className="fhc-ds__monogram" aria-hidden="true">PC</span>}
            facts={[
              { label: 'Due this week', value: 7090 },
              { label: 'October so far', value: 31480 },
              { label: 'Margin', value: '27.4%' }
            ]}
          />
        </Spec>
        <Spec label="Desktop facts, in rows">
          <VaultCard
            label="Balance"
            amount={6187.5}
            factsLayout="rows"
            facts={[
              { label: 'Contract', value: 12375 },
              { label: 'Paid', value: 6187.5 },
              { label: 'Margin', value: '31.2%' }
            ]}
          />
        </Spec>
        <Spec label="Loading">
          <div className="fhc-ds__vault-loading fh-onyx-scope">
            <Skeleton width="48%" height={14} />
            <Skeleton width="72%" height={44} />
            <Skeleton width="100%" height={1} />
            <Skeleton width="60%" height={14} />
          </div>
        </Spec>
      </Group>

      {/* ---------------- Skeleton ---------------- */}
      <Group id={id('skeleton')} title="Skeleton" note="Shaped like the data it stands in for. The shimmer holds still with reduced motion.">
        <Spec label="Line, block, circle">
          <div className="fhc-ds__stack">
            <div className="fhc-ds__row fhc-ds__row--nowrap">
              <Skeleton shape="circle" size={40} />
              <div className="fhc-ds__stack fhc-ds__grow">
                <Skeleton width="70%" height={14} />
                <Skeleton width="45%" />
              </div>
            </div>
            <Skeleton shape="block" height={72} />
          </div>
        </Spec>
        <Spec label="On onyx">
          <OnyxStage className="fhc-ds__stage" hairline={false}>
            <div className="fhc-ds__stack">
              <Skeleton width="40%" height={14} />
              <Skeleton width="85%" height={36} />
              <Skeleton width="65%" />
            </div>
          </OnyxStage>
        </Spec>
      </Group>

      {/* ---------------- Empty ---------------- */}
      <Group id={id('empty')} title="EmptyState" note="An icon, one line, and the one action that fills the list.">
        <Spec label="Jobs" wide>
          <EmptyState
            icon={HardHat}
            title="No jobs yet."
            action={<Button variant="primary" size="lg" to="/import">Import from Jobber</Button>}
          />
        </Spec>
      </Group>

      {/* ---------------- Key caps ---------------- */}
      <Group id={id('keycaps')} title="KeyCap" note="Small key labels for desktop shortcuts.">
        <Spec label="Keys">
          <div className="fhc-ds__row">
            <KeyCap label="Command K">⌘K</KeyCap>
            <KeyCap label="Escape">esc</KeyCap>
            <KeyCap>I</KeyCap>
            <KeyCap>M</KeyCap>
            <KeyCap>N</KeyCap>
          </div>
        </Spec>
        <Spec label="In buttons">
          <div className="fhc-ds__row">
            <Button variant="primary">Create invoice <KeyCap label="shortcut I">I</KeyCap></Button>
            <Button>Message <KeyCap label="shortcut M">M</KeyCap></Button>
          </div>
        </Spec>
        <Spec label="On onyx, in the sidebar search" wide>
          <OnyxStage className="fhc-ds__stage fhc-ds__stage--tight" hairline={false}>
            <div className="fhc-ds-search">
              <Icon icon={Search} size={18} />
              <span className="fhc-ds-search__text">Search or jump to</span>
              <KeyCap label="Command K">⌘K</KeyCap>
            </div>
          </OnyxStage>
        </Spec>
      </Group>

      {/* ---------------- Sheet ---------------- */}
      <Group id={id('sheet')} title="Sheet" note="Swipe down, Escape, a tap outside or Close all dismiss it. Type something first and it asks before it lets go.">
        <Spec label="Bottom sheet with a form" wide>
          <div className="fhc-ds__row">
            <Button onClick={() => setSheetOpen(true)} data-testid={`open-sheet-${theme}`}>Log a payment</Button>
            <span className="fhc-ds__note">{dirty ? 'Unsaved changes in the sheet.' : 'Nothing typed yet.'}</span>
          </div>
          <Sheet
            open={sheetOpen}
            onOpenChange={(next) => {
              setSheetOpen(next)
              if (!next) resetSheet()
            }}
            title="Log a payment"
            description="Whitcomb garage slab, $6,187.50 balance"
            dirty={dirty}
            container={sheetContainer}
            footer={
              <>
                <SheetCancel />
                <Button
                  variant="primary"
                  size="lg"
                  className="fhc-ds__grow"
                  disabled={!amount}
                  onClick={() => {
                    setSheetOpen(false)
                    resetSheet()
                  }}
                >
                  Save payment
                </Button>
              </>
            }
          >
            <div className="fhc-ds__stack fhc-ds__stack--loose">
              <Field
                label="Amount"
                inputMode="decimal"
                placeholder="6187.50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                helper="The balance is $6,187.50."
              />
              <Field
                label="Paid by"
                placeholder="Card, check, cash or ACH"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              />
              <Field
                label="Note"
                multiline
                placeholder="Anything the office should know"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </Sheet>
        </Spec>
      </Group>
    </div>
  )
}

export default function DesignSheet() {
  usePinDay()
  const photos = useSamplePhotos()
  const [nightColumn, setNightColumn] = useState<HTMLDivElement | null>(null)

  return (
    <main className="fhc-ds">
      <header className="fhc-ds__intro">
        <p className="fhc-ds__eyebrow">Fieldhorse redesign, development only</p>
        <h1 className="fhc-ds__title">Component sheet</h1>
        <p className="fhc-ds__lede">
          Every redesign component in every state. Day on the left, Night on the right, both drawn from the
          same design tokens.
        </p>
      </header>
      <div className="fhc-ds__cols">
        <section className="fhc-ds__col" aria-labelledby="fhc-ds-day-title">
          <h2 id="fhc-ds-day-title" className="fhc-ds__coltitle">Day</h2>
          <Board theme="day" photos={photos} sheetContainer={null} />
        </section>
        <div ref={setNightColumn} className="fhc-ds__col fhc-ds__col--night" data-theme="dark">
          <section aria-labelledby="fhc-ds-night-title">
            <h2 id="fhc-ds-night-title" className="fhc-ds__coltitle">Night</h2>
            <Board theme="night" photos={photos} sheetContainer={nightColumn} />
          </section>
        </div>
      </div>
    </main>
  )
}
