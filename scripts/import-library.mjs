#!/usr/bin/env node
/**
 * 把另一个鞋盒库合并进当前库。
 *
 *   node scripts/import-library.mjs <源数据库> <源存储目录> [--dry]
 *
 * 比如把本机的库搬到服务器上：先把源库和文件复制过去，再在目标端运行这个脚本。
 * 走数据库层而不是走接口，所以 id 和 created_at 都原样保留。
 *
 * 文件是内容寻址的，同样的字节永远落在同样的 key 上，因此合并天然幂等——
 * 重复跑一次不会产生副本，已经存在的资料会被跳过。
 */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const [sourceDbArg, sourceStoreArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dryRun = process.argv.includes('--dry')

if (!sourceDbArg || !sourceStoreArg) {
  console.error('用法: node scripts/import-library.mjs <源数据库> <源存储目录> [--dry]')
  process.exit(1)
}

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const sourceDbPath = resolve(sourceDbArg)
const sourceStore = resolve(sourceStoreArg)
const targetDbPath = resolve(process.env.DB_PATH || './data/shoebox.db')
const targetStore = resolve(process.env.STORAGE_DIR || './storage')

for (const [label, path] of [
  ['源数据库', sourceDbPath],
  ['源存储目录', sourceStore],
  ['目标数据库', targetDbPath],
]) {
  if (!existsSync(path)) {
    console.error(`找不到${label}：${path}`)
    process.exit(1)
  }
}
if (sourceDbPath === targetDbPath) {
  console.error('源和目标是同一个数据库。')
  process.exit(1)
}

const plain = (rows) => rows.map((r) => ({ ...r }))
const source = new DatabaseSync(sourceDbPath, { readOnly: true })
const target = new DatabaseSync(targetDbPath)
target.exec('PRAGMA foreign_keys = ON')

const manuals = plain(source.prepare('SELECT * FROM manuals ORDER BY created_at').all())
const existing = new Set(
  plain(target.prepare('SELECT id FROM manuals').all()).map((r) => r.id),
)

console.log(`源库 ${manuals.length} 份资料 → 目标库已有 ${existing.size} 份${dryRun ? '（dry run）' : ''}\n`)

const hasColumn = (db, table, column) =>
  plain(db.prepare(`PRAGMA table_info(${table})`).all()).some((c) => c.name === column)

const selectPages = source.prepare(
  `SELECT p.idx, ${hasColumn(source, 'pages', 'name') ? 'p.name AS page_name' : 'NULL AS page_name'}, f.*
   FROM pages p JOIN files f ON f.hash = p.hash
   WHERE p.manual_id = ? ORDER BY p.idx`,
)
if (hasColumn(target, 'manuals', 'brand') || !hasColumn(target, 'pages', 'name')) {
  console.error('目标库还是旧结构：先启动一次新版本的服务让它迁移，再来导入。')
  process.exit(1)
}
const insertManual = target.prepare(
  `INSERT INTO manuals (id, title, category, keywords, notes, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const insertFile = target.prepare(
  `INSERT INTO files (hash, key, mime, size, width, height, original_size, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING`,
)
const insertPage = target.prepare('INSERT INTO pages (manual_id, idx, hash, name) VALUES (?, ?, ?, ?)')

/**
 * A library from before the move to general 资料 has brand and model columns,
 * and its 分类 names a product (键盘) rather than a kind of document. Same rule
 * as the migration in src/lib/db.ts: all three go into the keywords and the
 * category becomes 说明书.
 */
const sourceIsOld = hasColumn(source, 'manuals', 'brand')

function foldKeywords(manual) {
  const parts = sourceIsOld ? [manual.brand, manual.model, manual.category, manual.keywords] : [manual.keywords]
  const seen = new Set()
  const words = []
  for (const part of parts.filter(Boolean).join(',').split(/[,，、;；\s]+/)) {
    const w = part.trim()
    if (!w || seen.has(w.toLowerCase())) continue
    seen.add(w.toLowerCase())
    words.push(w)
  }
  return words.length ? words.join(', ') : null
}

// markdown 页里嵌的图片不是页面，挂在 attachments 表上。老版本的库没有这张表。
const hasTable = (db, name) =>
  !!db.prepare(`SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
const sourceHasAttachments = hasTable(source, 'attachments')
const selectAttachments = sourceHasAttachments
  ? source.prepare(
      `SELECT a.src, f.* FROM attachments a JOIN files f ON f.hash = a.hash WHERE a.owner = ?`,
    )
  : null
const insertAttachment = hasTable(target, 'attachments')
  ? target.prepare('INSERT INTO attachments (owner, src, hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
  : null
if (sourceHasAttachments && !insertAttachment) {
  console.error('目标库还没有 attachments 表：先启动一次新版本的服务让它建表，再来导入。')
  process.exit(1)
}

let imported = 0
let skipped = 0
let copiedFiles = 0
let reusedFiles = 0
let missing = 0

for (const manual of manuals) {
  const pages = plain(selectPages.all(manual.id))
  const attachments = new Map(
    pages.map((p) => [p.hash, selectAttachments ? plain(selectAttachments.all(p.hash)) : []]),
  )
  const label = `${manual.title}（${pages.length} 页）`

  if (existing.has(manual.id)) {
    console.log(`· 跳过 ${label}：目标库里已有`)
    skipped++
    continue
  }

  // Copy the blobs first: a manual whose pages are missing would be unreadable.
  const absent = []
  for (const page of [...pages, ...[...attachments.values()].flat()]) {
    const from = join(sourceStore, page.key)
    const to = join(targetStore, page.key)
    if (existsSync(to)) {
      reusedFiles++
      continue
    }
    if (!existsSync(from)) {
      absent.push(page.key)
      continue
    }
    if (!dryRun) {
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
    }
    copiedFiles++
  }

  if (absent.length > 0) {
    console.warn(`✗ 跳过 ${label}：源存储里缺 ${absent.length} 个文件`)
    missing += absent.length
    skipped++
    continue
  }

  if (!dryRun) {
    target.exec('BEGIN')
    try {
      insertManual.run(
        manual.id,
        manual.title,
        sourceIsOld ? '说明书' : manual.category,
        foldKeywords(manual),
        manual.notes,
        manual.created_at,
      )
      for (const page of pages) {
        insertFile.run(
          page.hash,
          page.key,
          page.mime,
          page.size,
          page.width,
          page.height,
          page.original_size,
          page.created_at,
        )
        insertPage.run(manual.id, page.idx, page.hash, page.page_name ?? null)
        for (const a of attachments.get(page.hash) ?? []) {
          insertFile.run(a.hash, a.key, a.mime, a.size, a.width, a.height, a.original_size, a.created_at)
          insertAttachment.run(page.hash, a.src, a.hash)
        }
      }
      target.exec('COMMIT')
    } catch (err) {
      target.exec('ROLLBACK')
      throw err
    }
  }

  console.log(`✓ ${dryRun ? '将导入' : '已导入'} ${label}`)
  imported++
}

source.close()
target.close()

console.log(
  `\n完成：${dryRun ? '将' : '已'}导入 ${imported} 份，跳过 ${skipped} 份。` +
    `文件 ${dryRun ? '将复制' : '已复制'} ${copiedFiles} 个，复用 ${reusedFiles} 个` +
    (missing ? `，缺失 ${missing} 个` : '') +
    '。',
)
