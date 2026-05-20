// src/components/documents/ApprovalBlock.jsx
//
// "Approval / Signature" block at the bottom of every proposal. Renders
// the authorization paragraph + four signature fields (client sig +
// date, contractor sig + date).
//
// Three modes:
//   - mode="blank"    print-ready empty signature lines (default)
//   - mode="approved" stamps the contractor's existing approval payload
//                       (typed name / drawn signature image / approval
//                       method) over the blank lines so the executed
//                       version is unambiguous
//   - mode="readonly" shows the lines but disables hint text (used when
//                       rendering inside a preview that itself is not
//                       the signing surface)
//
// The signing surface itself lives elsewhere (approval flow in
// ContactDetail/Quote tab); this block is presentation only.

import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.ts'
import { longDate } from './format.ts'

const AUTHORIZATION_COPY = `By signing below, the customer authorizes the company to perform the work outlined in this proposal and agrees to the terms and conditions contained herein.`

export default function ApprovalBlock({
  company,
  contractorName,
  mode = 'blank',
  clientName,
  clientSignatureDataUrl,
  clientApprovedAt,
  contractorSignatureDataUrl,
  contractorApprovedAt
}) {
  const gold = resolveBrandGold(company)
  const stamped = mode === 'approved'

  return (
    <section style={{ breakInside: 'avoid' }}>
      <p
        style={{
          ...typeStyle('body'),
          color: DOC_COLORS.inkMid,
          margin: '0 0 22px',
          maxWidth: '60ch'
        }}
      >
        {AUTHORIZATION_COPY}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24
        }}
      >
        <SignatureField
          label="Client signature"
          name={clientName}
          dataUrl={stamped ? clientSignatureDataUrl : null}
          dateLabel="Date"
          date={stamped ? longDate(clientApprovedAt) : ''}
          gold={gold}
        />
        <SignatureField
          label="Contractor signature"
          name={contractorName || company?.name}
          dataUrl={stamped ? contractorSignatureDataUrl : null}
          dateLabel="Date"
          date={stamped ? longDate(contractorApprovedAt) : ''}
          gold={gold}
        />
      </div>
    </section>
  )
}

function SignatureField({ label, name, dataUrl, dateLabel, date, gold }) {
  return (
    <div>
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'flex-end',
          borderBottom: `1px solid ${DOC_COLORS.ink}`,
          paddingBottom: 4
        }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`${name || 'Signature'} signature`}
            style={{ maxHeight: 56, maxWidth: '100%', display: 'block' }}
          />
        ) : name ? (
          <span
            style={{
              fontFamily: "'Caveat', 'Snell Roundhand', cursive",
              fontSize: 28,
              color: DOC_COLORS.inkMid
            }}
          >
            {name}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12
        }}
      >
        <div style={{ ...typeStyle('label'), color: DOC_COLORS.inkMuted }}>
          {label}
        </div>
        <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted }}>
          {dateLabel}{date ? `: ${date}` : ''}
        </div>
      </div>
      {name && (
        <div
          style={{
            ...typeStyle('sub'),
            color: DOC_COLORS.inkMuted,
            marginTop: 2
          }}
        >
          {name}
        </div>
      )}
    </div>
  )
}
