// File type rules for the job Files tab.
//
// The job-files bucket takes any document type, but a web page, SVG or
// XML file opened straight from storage can run script on the storage
// domain. So those are never stored from the Files tab, and when a file
// is opened only PDFs and plain images show in a tab: everything else
// downloads under its own name.

const BLOCKED_TYPES = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml'])
const BLOCKED_EXTENSIONS = new Set(['html', 'htm', 'shtml', 'xhtml', 'xht', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'mht', 'mhtml'])

const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const INLINE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'])

/** Lowercase extension of a file name (letters and digits only), or ''. */
export function extensionOf(name: unknown): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

/** True for files the Files tab refuses to store (web pages, SVG, XML). */
export function isBlockedUpload(file: { name?: string | null; type?: string | null }): boolean {
  const type = String(file?.type || '').toLowerCase().split(';')[0].trim()
  return BLOCKED_TYPES.has(type) || BLOCKED_EXTENSIONS.has(extensionOf(file?.name))
}

/**
 * True when a stored file may open in a browser tab. Both the recorded
 * type and the file name must say PDF or image, anything else downloads.
 */
export function opensInline(row: { mime_type?: string | null; filename?: string | null } | null | undefined): boolean {
  return INLINE_TYPES.has(String(row?.mime_type || '').toLowerCase())
    && INLINE_EXTENSIONS.has(extensionOf(row?.filename))
}
