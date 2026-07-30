// src/components/documents/BillToBlock.tsx
//
// "Bill to" panel for invoices + the "Prepared for" panel for
// proposals. Same visual treatment, one side renders the client
// identity (name + address + phone + email), the other the project
// snapshot (project title + project address + a one-line snapshot
// metric like "Phase 2 of 4" or "Started Apr 12").
//
// Both sides are optional; the block collapses cleanly when only one
// is provided.

import { DOC_COLORS, typeStyle } from './tokens.ts'

/**
 * @param {object} props
 * @param {string} [props.clientLabel='BILL TO']
 * @param {object} props.client     { name, address, phone, email }
 * @param {string} [props.projectLabel='PROJECT']
 * @param {object} [props.project]  { title, address, snapshot }
 */
export default function BillToBlock({
  clientLabel = 'BILL TO',
  client = {},
  projectLabel = 'PROJECT',
  project = null
}: { clientLabel?: string; client?: any; projectLabel?: string; project?: any }) {
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: project ? '1fr 1fr' : '1fr',
        gap: 24
      }}
    >
      <Panel label={clientLabel}>
        <div style={{ ...typeStyle('h3'), color: DOC_COLORS.ink, marginBottom: 4 }}>
          {client?.name || '\u2003'}
        </div>
        {client?.address && (
          <div style={{ ...typeStyle('body'), color: DOC_COLORS.inkMid }}>
            {client.address}
          </div>
        )}
        <ContactLines client={client} />
      </Panel>

      {project && (
        <Panel label={projectLabel}>
          {project.title && (
            <div style={{ ...typeStyle('h3'), color: DOC_COLORS.ink, marginBottom: 4 }}>
              {project.title}
            </div>
          )}
          {project.address && (
            <div style={{ ...typeStyle('body'), color: DOC_COLORS.inkMid }}>
              {project.address}
            </div>
          )}
          {project.snapshot && (
            <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 6 }}>
              {project.snapshot}
            </div>
          )}
        </Panel>
      )}
    </section>
  )
}

function Panel({ label, children }: { label?: import('react').ReactNode; children?: import('react').ReactNode }) {
  return (
    <div>
      <div
        style={{
          ...typeStyle('label'),
          color: DOC_COLORS.inkMuted,
          marginBottom: 8
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function ContactLines({ client }: { client?: any }) {
  const lines = [client?.phone, client?.email].map((s) => (s && String(s).trim()) || '').filter(Boolean)
  if (!lines.length) return null
  return (
    <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 6 }}>
      {lines.join(' · ')}
    </div>
  )
}
