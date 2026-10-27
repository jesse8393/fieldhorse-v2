/** A document's issue date stays stable when it is sent again or downloaded.
 * Existing quotes have no separate issued_at column. Their persisted creation
 * date is the stable document date; sent_at is delivery history, used only for
 * old records missing their creation date. */
export function proposalIssuedAt(record: { created_at?: string | null; quote_sent_at?: string | null; sent_at?: string | null }): string | null {
  for (const value of [record.created_at, record.quote_sent_at, record.sent_at]) {
    if (value && Number.isFinite(Date.parse(value))) return value
  }
  return null
}
