export type DriverName = 'local' | 'r2'

export interface StorageDriver {
  readonly name: DriverName
  /** Whether the browser can PUT straight to the bucket with a signed URL. */
  readonly supportsPresign: boolean
  put(key: string, body: Buffer | Uint8Array, mime: string): Promise<void>
  /** Reads a stored object back, e.g. a markdown page for server-side rendering. */
  get(key: string): Promise<Buffer>
  presignPut(key: string, mime: string): Promise<string>
  /** A URL the browser can render. May be signed and short-lived. */
  url(key: string): Promise<string>
  /** A URL that downloads the blob under its original file name. */
  downloadUrl(key: string, name: string): Promise<string>
  remove(key: string): Promise<void>
  has(key: string): Promise<boolean>
}

const EXT_BY_MIME: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'text/markdown': 'md',
}

/** Everything else — arbitrary files — is stored as `.bin`. */
export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin'
}

/** RFC 6266 header value that survives non-ASCII names like 报价单.xlsx. */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Content-addressed key: identical bytes always land on the same object. */
export function keyForHash(hash: string, mime: string): string {
  return `pages/${hash.slice(0, 2)}/${hash}.${extForMime(mime)}`
}
