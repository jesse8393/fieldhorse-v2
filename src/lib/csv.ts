// Shared CSV building + download. Extracted from SnowInvoicesBuild /
// SnowClientsBuild (audit: the escaping and Blob-download ritual was
// duplicated verbatim, an escaping fix must land once, not twice).

/** RFC-4180-style field escaping: quote when the value contains a
 *  delimiter, quote, or newline; double any embedded quotes. */
export function escapeCsvField(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Assemble a CSV string from a header row + data rows. Cells are
 *  escaped here, pass raw values. */
export function buildCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(escapeCsvField).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsvField).join(','))
  return lines.join('\n')
}

/** Trigger a client-side download of a CSV string. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
