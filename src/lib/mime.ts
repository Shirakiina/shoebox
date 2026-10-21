/**
 * Page types, kept free of heavy imports so anything — server routes, the
 * upload form's first paint — can use them without pulling markdown-it in.
 */

export const MARKDOWN_MIME = 'text/markdown'
export const PDF_MIME = 'application/pdf'
export const BINARY_MIME = 'application/octet-stream'

/** Raster types the compressor produces and every browser can show. */
const RASTER_MIME = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/avif'])

/**
 * How a page is shown. Anything that is not a picture, a PDF or markdown —
 * a Word file, a spreadsheet, a HEIC the browser can't decode — is a "file":
 * stored byte for byte and offered as a download, never rendered.
 */
export type PageKind = 'image' | 'pdf' | 'markdown' | 'file'

export function pageKind(mime: string): PageKind {
  if (RASTER_MIME.has(mime)) return 'image'
  if (mime === PDF_MIME) return 'pdf'
  if (mime === MARKDOWN_MIME) return 'markdown'
  return 'file'
}

export function isImageMime(mime: string): boolean {
  return pageKind(mime) === 'image'
}

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name)
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i

/** A browser- or client-supplied type, or the generic binary type if it isn't one. */
export function normalizeMime(mime: string | null | undefined): string {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase()
  return MIME_RE.test(m) ? m : BINARY_MIME
}

/**
 * The Content-Type a blob is stored and served under. Arbitrary files go out
 * as opaque bytes whatever they claim to be: an uploaded .html or .svg served
 * as itself from this origin (or the bucket's) would run its scripts.
 */
export function storageContentType(mime: string): string {
  return pageKind(mime) === 'file' ? BINARY_MIME : mime
}

/** Original file names travel with pages; keep them printable and bounded. */
export function cleanFileName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200)
  return clean || null
}

/** "报价单.xlsx" → "XLSX"; no usable extension → "文件". */
export function extLabel(name: string | null | undefined): string {
  const ext = name?.match(/\.([a-z0-9]{1,6})$/i)?.[1]
  return ext ? ext.toUpperCase() : '文件'
}

/** Label shown in place of a thumbnail for pages that aren't pictures. */
export function pageBadge(mime: string, name?: string | null): string | undefined {
  switch (pageKind(mime)) {
    case 'pdf':
      return 'PDF'
    case 'markdown':
      return 'MD'
    case 'file':
      return extLabel(name)
    default:
      return undefined
  }
}
