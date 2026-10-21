#!/usr/bin/env node
/**
 * Push every locally-stored blob up to Cloudflare R2.
 *
 *   npm run sync:r2            # upload what's missing
 *   npm run sync:r2 -- --dry   # just report
 *
 * Storage keys are content hashes, identical under both drivers, so nothing in
 * the database has to change: after a sync you can flip STORAGE_DRIVER=r2 and
 * every existing item keeps working.
 */
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

const dryRun = process.argv.includes('--dry')
const storageDir = resolve(process.env.STORAGE_DIR || './storage')
const dbPath = resolve(process.env.DB_PATH || './data/shoebox.db')

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
const missing = required.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`缺少环境变量：${missing.join(', ')}\n请在 .env.local 里补上。`)
  process.exit(1)
}
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`)
  process.exit(1)
}

const bucket = process.env.R2_BUCKET
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const MIME = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
}

const db = new DatabaseSync(dbPath, { readOnly: true })
const files = db
  .prepare('SELECT hash, key, mime, size FROM files ORDER BY created_at')
  .all()
  .map((r) => ({ ...r }))
db.close()

console.log(`数据库里有 ${files.length} 个文件，目标存储桶：${bucket}${dryRun ? '（dry run）' : ''}\n`)

let uploaded = 0
let skipped = 0
let absent = 0
let bytes = 0

for (const [i, file] of files.entries()) {
  const local = join(storageDir, file.key)
  const label = `[${i + 1}/${files.length}] ${file.key}`

  if (!existsSync(local)) {
    console.warn(`${label}  本地文件不存在，跳过`)
    absent++
    continue
  }

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: file.key }))
    skipped++
    continue
  } catch {
    // not in the bucket yet — upload below
  }

  if (dryRun) {
    console.log(`${label}  待上传 ${(file.size / 1024).toFixed(0)} KB`)
    uploaded++
    bytes += file.size
    continue
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: file.key,
      Body: createReadStream(local),
      ContentLength: statSync(local).size,
      // Only page types go up as themselves; arbitrary files (.bin) as opaque
      // bytes, as the server does — see storageContentType in src/lib/mime.ts.
      ContentType: MIME[extname(local).toLowerCase()] ?? 'application/octet-stream',
    }),
  )
  console.log(`${label}  ✓`)
  uploaded++
  bytes += file.size
}

console.log(
  `\n完成：${dryRun ? '待' : '已'}上传 ${uploaded} 个（${(bytes / 1024 / 1024).toFixed(1)} MB）` +
    `，已存在 ${skipped} 个，本地缺失 ${absent} 个。`,
)
if (!dryRun && uploaded > 0) {
  console.log('接下来把 .env.local 里的 STORAGE_DRIVER 改成 r2，重启即可从云端读取。')
}
