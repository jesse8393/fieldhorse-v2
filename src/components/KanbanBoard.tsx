import { useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners
} from '@dnd-kit/core'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { motion } from 'framer-motion'
import { GripVertical } from 'lucide-react'
import { hapticStageChange, hapticTap } from '../lib/haptics.ts'
import { Eyebrow } from './v3'

// Stage columns shown left-to-right. "lost" lives off-board (URL-only).
// Pipeline v2: the Invoice column is gone — invoicing is fh_invoices
// rows on the job, not a stage.
const COLUMNS = [
  { id: 'lead',    label: 'Lead' },
  { id: 'quote',   label: 'Quote' },
  { id: 'job',     label: 'Active' },
  { id: 'closed',  label: 'Complete' }
]

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function initials(name: any) {
  if (!name) return '—'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w: any) => w[0].toUpperCase()).join('')
}

function KanbanCard({ contact, dragging, onOpen }: any) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: contact.id, data: { contact } })
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {}
  // Tap-to-open: PointerSensor activationConstraint.distance=6 means
  // releases under 6 px of movement never start a drag. Use the
  // pointerup event (not click — dnd-kit absorbs click) and only
  // navigate if no drag actually occurred.
  function handlePointerUp(e: any) {
    if (isDragging) return
    if (e.button !== undefined && e.button !== 0) return
    onOpen?.(contact)
  }
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        position: 'relative',
        padding: '11px 12px',
        borderRadius: 12,
        background: 'var(--v3-glass-tint)',
        border: '1px solid var(--rule)',
        boxShadow: dragging
          ? '0 18px 44px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)'
          : '0 2px 6px rgba(0, 0, 0, 0.35), 0 12px 24px rgba(0, 0, 0, 0.30)',
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none'
      }}
      onPointerUp={handlePointerUp}
      {...listeners}
      {...attributes}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span aria-hidden="true" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(201,150,58,0.14)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-display)', fontSize: 13 }}>
          {initials(contact.name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact.name || 'Untitled'}
          </div>
          {(contact.job_title || contact.job_type) && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {contact.job_title || contact.job_type}
            </div>
          )}
        </div>
        <GripVertical size={14} color="var(--ink-faint)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="fh-money" style={{ fontFamily: 'var(--font-display)', fontSize: 16, lineHeight: 1, opacity: Number(contact.amount || 0) > 0 ? 1 : 0.4 }}>
          {money(contact.amount)}
        </span>
        <Eyebrow style={{ color: 'var(--ink-faint)' }}>
          #{String(contact.id).slice(0, 6)}
        </Eyebrow>
      </div>
    </div>
  )
}

function KanbanColumn({ id, label, contacts, isOver, onOpen }: any) {
  const { setNodeRef } = useDroppable({ id })
  const total = contacts.reduce((s: any, c: any) => s + Number(c.amount || 0), 0)
  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 16,
        minHeight: 220,
        background: isOver ? 'rgba(199, 164, 90, 0.06)' : 'var(--v3-glass-tint)',
        border: isOver ? '1px solid rgba(199, 164, 90, 0.45)' : '1px solid var(--rule)',
        transition: 'background 120ms cubic-bezier(0.5, 0, 0.2, 1), border-color 120ms'
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span className={`fh-stage-pill fh-stage-pill--${id}`}>
          {label.toUpperCase()}
        </span>
        <Eyebrow style={{ color: 'var(--ink-muted)' }}>
          {contacts.length} · {money(total)}
        </Eyebrow>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contacts.map((c: any) => (
          <KanbanCard key={c.id} contact={c} onOpen={onOpen} />
        ))}
        {contacts.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--ink-faint)', border: '1px dashed var(--rule)', borderRadius: 10 }}>
            Empty column
          </div>
        )}
      </div>
    </div>
  )
}

export default function KanbanBoard({ contacts, onStageChange, onOpen }: any) {
  const [activeId, setActiveId] = useState<any>(null)
  const [overColumn, setOverColumn] = useState<any>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } })
  )

  const byStage = useMemo(() => {
    const out: Record<string, any[]> = Object.fromEntries(COLUMNS.map((c: any) => [c.id, []]))
    for (const c of contacts || []) {
      if (out[c.stage]) out[c.stage].push(c)
    }
    return out
  }, [contacts])

  const activeContact = activeId ? (contacts || []).find((c: any) => c.id === activeId) : null

  function handleDragStart(e: any) {
    setActiveId(e.active.id)
    hapticTap()
  }

  function handleDragOver(e: any) {
    setOverColumn(e.over?.id || null)
  }

  function handleDragEnd(e: any) {
    const id = e.active.id
    const targetStage = e.over?.id
    setActiveId(null)
    setOverColumn(null)
    if (!targetStage || !COLUMNS.some((c) => c.id === targetStage)) return
    const moved = (contacts || []).find((c: any) => c.id === id)
    if (!moved || moved.stage === targetStage) return
    hapticStageChange()
    onStageChange?.(id, targetStage)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); setOverColumn(null) }}
    >
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.5, 0, 0.2, 1] }}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`,
          gap: 12,
          padding: '4px 20px 20px',
          overflowX: 'auto'
        }}
      >
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            label={col.label}
            contacts={byStage[col.id] || []}
            isOver={overColumn === col.id}
            onOpen={onOpen}
          />
        ))}
      </motion.div>
      <DragOverlay dropAnimation={{ duration: 100, easing: 'cubic-bezier(0.5, 0, 0.2, 1)' }}>
        {activeContact ? <KanbanCard contact={activeContact} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}
