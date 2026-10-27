/** Apply the same plain text interpretation to preview, direct send and mailto. */
export function plainDraft(text: string): string {
  return String(text || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
}

export function emailDraft(text: string, fallbackSubject: string): { subject: string; body: string } {
  const cleaned = plainDraft(text).trim()
  const match = /^Subject\s*:\s*([^\r\n]+)(?:\r?\n|$)/i.exec(cleaned)
  return {
    subject: match?.[1]?.trim() || fallbackSubject,
    body: match ? cleaned.slice(match[0].length).trimStart() : cleaned,
  }
}
