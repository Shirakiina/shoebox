import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { normalizeKeywords, parseKeywords } from './keywords'

/**
 * One library entry — a manual, a business card, a contract… The table keeps
 * its original name; only the UI calls these 资料.
 */
export type ManualRow = {
  id: string
  title: string
  category: string | null
  keywords: string | null
  notes: string | null
  created_at: number
  page_count: number
  cover_key: string | null
  cover_mime: string | null
  cover_name: string | null
  /** 1 when the cover is wider than tall — a business card, a receipt strip. */
  cover_wide: number | null
}

export type PageRow = {
  idx: number
  hash: string
  key: string
  mime: string
  size: number
  width: number | null
  height: number | null
  /** Original file name, for downloads; null for pages stored before names were. */
  name: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS manuals (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  category   TEXT,
  keywords   TEXT,
  notes      TEXT,
  created_at INTEGER NOT NULL
);

-- Content-addressed blobs: one row per distinct sha256, so re-uploading the
-- same page from another manual costs nothing but a pages row.
CREATE TABLE IF NOT EXISTS files (
  hash          TEXT PRIMARY KEY,
  key           TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  original_size INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  manual_id TEXT NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  hash      TEXT NOT NULL REFERENCES files(hash),
  -- Per page, not per file: the same bytes may arrive under different names.
  name      TEXT,
  PRIMARY KEY (manual_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_pages_hash ON pages(hash);
CREATE INDEX IF NOT EXISTS idx_manuals_created ON manuals(created_at DESC);

-- Images embedded in a markdown page. They are not pages themselves, so this
-- is what keeps them alive: owned by the markdown blob's hash, and collected
-- together with it once no page refers to that markdown any more.
-- src is the image address exactly as the markdown writes it; the stored
-- markdown is the untouched original, and rendering maps src -> image here.
CREATE TABLE IF NOT EXISTS attachments (
  owner TEXT NOT NULL,
  src   TEXT NOT NULL,
  hash  TEXT NOT NULL,
  PRIMARY KEY (owner, src)
);
CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(hash);
`

let cached: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (cached) return cached
  const path = resolve(process.env.DB_PATH || './data/shoebox.db')
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  cached = db
  return db
}

function migrate(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(manuals)`).all() as { name: string }[]).map((c) => c.name),
  )
  if (!columns.has('keywords')) {
    db.exec(`ALTER TABLE manuals ADD COLUMN keywords TEXT`)
  }
  // From manual library to general one. Brand and model only made sense for
  // manuals, and 分类 used to mean the product (键盘, 家电) where it now means
  // the kind of document (说明书, 名片, 合同). Everything stored before this
  // was a manual, so: brand, model and the old category move into the
  // keywords — still shown, still searchable — the category becomes 说明书,
  // and the two columns are dropped. Runs once: the brand column is the marker.
  if (columns.has('brand') || columns.has('model')) {
    const rows = plain<{
      id: string
      brand: string | null
      model: string | null
      category: string | null
      keywords: string | null
    }>(db.prepare(`SELECT id, brand, model, category, keywords FROM manuals`).all())
    const update = db.prepare(`UPDATE manuals SET keywords = ?, category = '说明书' WHERE id = ?`)
    db.exec('BEGIN')
    try {
      for (const r of rows) {
        const words = [r.brand, r.model, r.category, r.keywords].filter(Boolean).join(', ')
        update.run(normalizeKeywords(words), r.id)
      }
      if (columns.has('brand')) db.exec(`ALTER TABLE manuals DROP COLUMN brand`)
      if (columns.has('model')) db.exec(`ALTER TABLE manuals DROP COLUMN model`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  const pageCols = (db.prepare(`PRAGMA table_info(pages)`).all() as { name: string }[]).map((c) => c.name)
  if (!pageCols.includes('name')) {
    db.exec(`ALTER TABLE pages ADD COLUMN name TEXT`)
  }
  // An early shape of this table had no src column and never shipped; it can
  // only be empty, so rebuild it.
  const attachmentCols = (db.prepare(`PRAGMA table_info(attachments)`).all() as { name: string }[]).map(
    (c) => c.name,
  )
  if (attachmentCols.length > 0 && !attachmentCols.includes('src')) {
    db.exec(`DROP TABLE attachments`)
    db.exec(SCHEMA)
  }
  // Left behind by the OCR feature that was removed.
  db.exec(`DROP TABLE IF EXISTS page_fts`)
  db.exec(`DROP TABLE IF EXISTS page_text`)
}

/** node:sqlite hands back null-prototype rows; copy them into plain objects. */
function plain<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as object) })) as T[]
}

function tx<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/* ------------------------------------------------------------ queries ---- */

const LIST_SELECT = `
  SELECT m.*,
         (SELECT COUNT(*) FROM pages p WHERE p.manual_id = m.id)      AS page_count,
         (SELECT f.key  FROM pages p JOIN files f ON f.hash = p.hash
           WHERE p.manual_id = m.id ORDER BY p.idx LIMIT 1)           AS cover_key,
         (SELECT f.mime FROM pages p JOIN files f ON f.hash = p.hash
           WHERE p.manual_id = m.id ORDER BY p.idx LIMIT 1)           AS cover_mime,
         (SELECT p.name FROM pages p
           WHERE p.manual_id = m.id ORDER BY p.idx LIMIT 1)           AS cover_name,
         (SELECT f.width > f.height FROM pages p JOIN files f ON f.hash = p.hash
           WHERE p.manual_id = m.id ORDER BY p.idx LIMIT 1)           AS cover_wide
  FROM manuals m
`

/**
 * Every searchable field, combined into one haystack per entry. File names
 * count too: a contract is often best remembered as "that 合同-2024.docx".
 */
const HAYSTACK = `(
  COALESCE(m.title,'')    || ' ' || COALESCE(m.category,'') || ' ' ||
  COALESCE(m.keywords,'') || ' ' || COALESCE(m.notes,'')    || ' ' ||
  COALESCE((SELECT GROUP_CONCAT(p.name, ' ') FROM pages p WHERE p.manual_id = m.id), '')
)`

/**
 * Space-separated terms are ANDed, and each term may match any field — so
 * "博世 洗碗机" finds an entry titled 博世… whose keywords mention 洗碗机,
 * which a single whole-string LIKE would miss. `category` filters exactly.
 */
export function listManuals(q?: string, category?: string): ManualRow[] {
  const db = getDb()
  const terms = (q ?? '').trim().split(/\s+/).filter(Boolean)
  const where = terms.map(() => `${HAYSTACK} LIKE ?`)
  const params: string[] = terms.map((t) => `%${t}%`)
  if (category) {
    where.push(`m.category = ?`)
    params.push(category)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return plain<ManualRow>(
    db.prepare(`${LIST_SELECT} ${clause} ORDER BY m.created_at DESC`).all(...params),
  )
}

/** Categories in use, most common first — the type tabs on the library page. */
export function allCategories(): { name: string; count: number }[] {
  return plain<{ name: string; count: number }>(
    getDb()
      .prepare(
        `SELECT category AS name, COUNT(*) AS count FROM manuals
          WHERE category IS NOT NULL AND category <> ''
          GROUP BY category ORDER BY count DESC, category`,
      )
      .all(),
  )
}

export function getManual(id: string): ManualRow | undefined {
  const row = getDb().prepare(`${LIST_SELECT} WHERE m.id = ?`).get(id)
  return row ? ({ ...(row as object) } as ManualRow) : undefined
}

export function getPages(manualId: string): PageRow[] {
  return plain<PageRow>(
    getDb()
      .prepare(
        `SELECT p.idx, p.hash, p.name, f.key, f.mime, f.size, f.width, f.height
         FROM pages p JOIN files f ON f.hash = p.hash
         WHERE p.manual_id = ? ORDER BY p.idx`,
      )
      .all(manualId),
  )
}

/** Every keyword in use, most common first — powers the filter chips. */
export function allKeywords(): { word: string; count: number }[] {
  const rows = plain<{ keywords: string | null }>(
    getDb().prepare(`SELECT keywords FROM manuals WHERE keywords IS NOT NULL`).all(),
  )
  const tally = new Map<string, { word: string; count: number }>()
  for (const row of rows) {
    for (const word of parseKeywords(row.keywords)) {
      const key = word.toLowerCase()
      const hit = tally.get(key)
      if (hit) hit.count++
      else tally.set(key, { word, count: 1 })
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

export function knownHashes(hashes: string[]): Set<string> {
  if (hashes.length === 0) return new Set()
  const placeholders = hashes.map(() => '?').join(',')
  const rows = plain<{ hash: string }>(
    getDb().prepare(`SELECT hash FROM files WHERE hash IN (${placeholders})`).all(...hashes),
  )
  return new Set(rows.map((r) => r.hash))
}

export function lookupFiles(hashes: string[]): Map<string, { key: string; mime: string }> {
  const map = new Map<string, { key: string; mime: string }>()
  if (hashes.length === 0) return map
  const placeholders = hashes.map(() => '?').join(',')
  const rows = plain<{ hash: string; key: string; mime: string }>(
    getDb()
      .prepare(`SELECT hash, key, mime FROM files WHERE hash IN (${placeholders})`)
      .all(...hashes),
  )
  for (const r of rows) map.set(r.hash, { key: r.key, mime: r.mime })
  return map
}

export type IncomingFile = {
  hash: string
  key: string
  mime: string
  size: number
  width?: number | null
  height?: number | null
  originalSize?: number | null
}

export type IncomingAttachment = IncomingFile & {
  /** The image address as written in the markdown source. */
  src: string
}

export type IncomingPage = IncomingFile & {
  /** Original file name, kept for downloads. */
  name?: string | null
  /** Images a markdown page embeds; empty for every other page type. */
  attachments?: IncomingAttachment[]
}

export type AttachmentRow = {
  src: string
  hash: string
  key: string
  mime: string
  size: number
  width: number | null
  height: number | null
}

/** Embedded images for each markdown page, keyed by the markdown's hash. */
export function getAttachments(owners: string[]): Map<string, AttachmentRow[]> {
  const map = new Map<string, AttachmentRow[]>()
  if (owners.length === 0) return map
  const placeholders = owners.map(() => '?').join(',')
  const rows = plain<AttachmentRow & { owner: string }>(
    getDb()
      .prepare(
        `SELECT a.owner, a.src, f.hash, f.key, f.mime, f.size, f.width, f.height
         FROM attachments a JOIN files f ON f.hash = a.hash
         WHERE a.owner IN (${placeholders})`,
      )
      .all(...owners),
  )
  for (const { owner, ...file } of rows) {
    const list = map.get(owner) ?? []
    list.push(file)
    map.set(owner, list)
  }
  return map
}

/** Writes page rows plus their files and attachments. Caller owns the transaction. */
function insertPages(db: DatabaseSync, manualId: string, pages: IncomingPage[], now: number) {
  const insertFile = db.prepare(
    `INSERT INTO files (hash, key, mime, size, width, height, original_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO NOTHING`,
  )
  const insertPage = db.prepare(`INSERT INTO pages (manual_id, idx, hash, name) VALUES (?, ?, ?, ?)`)
  // First mapping wins: the markdown is content-addressed, so the same bytes
  // uploaded again describe the same images.
  const insertAttachment = db.prepare(
    `INSERT INTO attachments (owner, src, hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
  )
  const file = (f: IncomingFile) =>
    insertFile.run(
      f.hash,
      f.key,
      f.mime,
      f.size,
      f.width ?? null,
      f.height ?? null,
      f.originalSize ?? null,
      now,
    )

  pages.forEach((p, i) => {
    file(p)
    insertPage.run(manualId, i, p.hash, p.name ?? null)
    for (const a of p.attachments ?? []) {
      file(a)
      insertAttachment.run(p.hash, a.src, a.hash)
    }
  })
}

/**
 * Deletes every candidate that nothing references any more and returns their
 * storage keys. A file is alive while a page uses it or while it is an
 * attachment of a markdown page that is itself alive — so dropping a markdown
 * page releases its images, which are then re-checked in turn. Caller owns the
 * transaction.
 */
function collectOrphans(db: DatabaseSync, candidates: Iterable<string>): string[] {
  const inPages = db.prepare(`SELECT 1 AS n FROM pages WHERE hash = ? LIMIT 1`)
  const isAttachment = db.prepare(`SELECT 1 AS n FROM attachments WHERE hash = ? LIMIT 1`)
  const childrenOf = db.prepare(`SELECT hash FROM attachments WHERE owner = ?`)
  const releaseChildren = db.prepare(`DELETE FROM attachments WHERE owner = ?`)
  const getKey = db.prepare(`SELECT key FROM files WHERE hash = ?`)
  const dropFile = db.prepare(`DELETE FROM files WHERE hash = ?`)

  const queue = [...new Set(candidates)]
  const dropped = new Set<string>()
  const orphaned: string[] = []

  while (queue.length > 0) {
    const hash = queue.pop()!
    if (dropped.has(hash)) continue
    if (inPages.get(hash) || isAttachment.get(hash)) continue

    // Re-queue children even if seen before: one judged alive earlier may
    // have been alive only through the owner being released right now.
    queue.push(...plain<{ hash: string }>(childrenOf.all(hash)).map((r) => r.hash))
    releaseChildren.run(hash)

    const row = getKey.get(hash) as { key: string } | undefined
    if (row) orphaned.push(row.key)
    dropFile.run(hash)
    dropped.add(hash)
  }
  return orphaned
}

export type EditableMeta = {
  title: string
  category?: string
  keywords?: string
  notes?: string
}

export function createManual(meta: EditableMeta & { id: string }, pages: IncomingPage[]) {
  const db = getDb()
  const now = Date.now()

  const insertManual = db.prepare(
    `INSERT INTO manuals (id, title, category, keywords, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  tx(() => {
    insertManual.run(
      meta.id,
      meta.title,
      meta.category?.trim() || null,
      normalizeKeywords(meta.keywords),
      meta.notes || null,
      now,
    )
    insertPages(db, meta.id, pages, now)
  })
}

/** Metadata only — pages are not touched. Returns false if the id is unknown. */
export function updateManual(id: string, meta: EditableMeta): boolean {
  const db = getDb()
  const result = db
    .prepare(
      `UPDATE manuals
          SET title = ?, category = ?, keywords = ?, notes = ?
        WHERE id = ?`,
    )
    .run(
      meta.title,
      meta.category?.trim() || null,
      normalizeKeywords(meta.keywords),
      meta.notes || null,
      id,
    )
  return result.changes > 0
}

/**
 * Swaps a manual's page list wholesale (reorder, remove, append in one shot)
 * and returns the storage keys that nothing references any more.
 */
export function replacePages(manualId: string, pages: IncomingPage[]): string[] {
  const db = getDb()
  return tx(() => {
    const before = plain<{ hash: string }>(
      db.prepare(`SELECT hash FROM pages WHERE manual_id = ?`).all(manualId),
    ).map((r) => r.hash)

    db.prepare(`DELETE FROM pages WHERE manual_id = ?`).run(manualId)
    insertPages(db, manualId, pages, Date.now())

    // Anything that was on this manual and is now referenced nowhere.
    return collectOrphans(db, before)
  })
}

/**
 * Drops the manual and returns the storage keys of blobs no manual references
 * any more, so the caller can delete them from the bucket.
 */
export function deleteManual(id: string): string[] {
  const db = getDb()
  return tx(() => {
    const hashes = plain<{ hash: string }>(
      db.prepare(`SELECT hash FROM pages WHERE manual_id = ?`).all(id),
    ).map((r) => r.hash)
    db.prepare(`DELETE FROM manuals WHERE id = ?`).run(id)
    return collectOrphans(db, hashes)
  })
}

export function stats() {
  const db = getDb()
  const row = {
    ...(db
      .prepare(
        `SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes,
                COALESCE(SUM(original_size),0) AS original_bytes FROM files`,
      )
      .get() as object),
  } as { files: number; bytes: number; original_bytes: number }
  const manuals = (db.prepare(`SELECT COUNT(*) AS n FROM manuals`).get() as { n: number }).n
  const pageRefs = (db.prepare(`SELECT COUNT(*) AS n FROM pages`).get() as { n: number }).n
  const attachmentRefs = (db.prepare(`SELECT COUNT(*) AS n FROM attachments`).get() as { n: number }).n
  return { ...row, manuals, pageRefs, dedupeSaved: pageRefs + attachmentRefs - row.files }
}
