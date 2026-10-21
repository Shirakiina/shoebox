import { lookupFiles, type IncomingFile, type IncomingPage } from './db'
import { getStorage, keyForHash } from './storage'
import { HASH_RE } from './ids'
import { MARKDOWN_MIME, cleanFileName, normalizeMime } from './mime'

/** Images a markdown page may embed — the same raster types pages use. */
const ATTACHMENT_MIME = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/avif'])

type Resolved = { pages: IncomingPage[] } | { error: string; status: number }

/**
 * Validates a client-supplied page list and produces the rows to store.
 *
 * The client never gets to choose a storage key: it is recomputed from the
 * content hash, and for blobs already on file the stored key wins. Shared by
 * manual creation and page editing so both enforce the same rules — and
 * applied to a markdown page's embedded images exactly as to pages.
 */
export async function resolvePages(incoming: IncomingPage[]): Promise<Resolved> {
  if (incoming.length === 0) return { error: '至少要有一页', status: 400 }

  const all: IncomingFile[] = []
  for (const page of incoming) {
    page.mime = normalizeMime(page.mime)
    all.push(page)
    const attachments = page.attachments ?? []
    if (attachments.length > 0 && page.mime !== MARKDOWN_MIME) {
      return { error: '只有 markdown 页可以带附件', status: 400 }
    }
    for (const a of attachments) {
      if (!ATTACHMENT_MIME.has(a.mime)) return { error: `不支持的附件类型：${a.mime}`, status: 400 }
      if (typeof a.src !== 'string' || !a.src || a.src.length > 4096) {
        return { error: '附件缺少合法的 src', status: 400 }
      }
      all.push(a)
    }
  }

  for (const file of all) {
    if (!file?.hash || !HASH_RE.test(file.hash)) {
      return { error: `非法 hash: ${file?.hash}`, status: 400 }
    }
  }

  const known = lookupFiles(all.map((f) => f.hash))
  const storage = getStorage()
  const verified = new Map<string, IncomingFile>()

  for (const file of all) {
    if (verified.has(file.hash)) continue
    const existing = known.get(file.hash)
    if (existing) {
      verified.set(file.hash, { ...file, key: existing.key, mime: existing.mime })
      continue
    }
    const key = keyForHash(file.hash, file.mime)
    if (!(await storage.has(key))) {
      return { error: `文件未上传成功: ${file.hash.slice(0, 8)}`, status: 409 }
    }
    verified.set(file.hash, { ...file, key })
  }

  return {
    pages: incoming.map((page) => ({
      ...verified.get(page.hash)!,
      name: cleanFileName(page.name),
      attachments: (page.attachments ?? []).map((a) => ({ ...verified.get(a.hash)!, src: a.src })),
    })),
  }
}
