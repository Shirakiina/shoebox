'use client'

import {
  isImage,
  isMarkdown,
  isPdf,
  naturalSort,
  processFile,
  sha256,
  type CompressOptions,
  type ProcessedFile,
} from './compress'
import { convertPdf } from './pdf'
import { planSlices, STRIP_RATIO } from './split'
import { errorMessage } from './http'
import { MAX_UPLOAD_BYTES } from './limits'

/**
 * The browser-side ingest pipeline: compress → hash → ask the server what it
 * already has → upload only what's missing. Shared by the upload form, the page
 * editor and web import, so every route into the library behaves identically.
 */

export type PreparedFile = {
  id: string
  name: string
  originalSize: number
  processed: ProcessedFile
  hash: string
  /** Already in the library — upload can be skipped entirely. */
  duplicate: boolean
  /** Images a markdown page embeds, keyed by the address the markdown uses. */
  attachments?: { src: string; file: PreparedFile }[]
}

export type PrepareResult = {
  prepared: PreparedFile[]
  problems: string[]
  /** Human-readable note per PDF or markdown file, e.g. "扫描件，拆成 6 页图片". */
  notes: string[]
  /** First heading of each markdown file — a better default title than "README". */
  titles: string[]
}

async function prepareOne(
  file: File,
  opts: CompressOptions,
  id: string,
  notes?: string[],
): Promise<PreparedFile> {
  const processed = await processFile(file, opts)
  if (processed.keptAsIs) notes?.push(`${file.name}：${processed.keptAsIs}`)
  const hash = await sha256(processed.blob)
  return { id: `${hash}-${id}-${Date.now()}`, name: file.name, originalSize: file.size, processed, hash, duplicate: false }
}

/* -------------------------------------------------------- markdown ---- */

type MarkdownPlan = { refs: { src: string; local?: File }[] }

/** Has a URL scheme (http:, data:, …) or is protocol-relative. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * Finds the file in this upload batch that a relative image address points
 * at. A multi-file drop only carries base names, so "./images/panel.png" is
 * matched by its full relative path when the browser supplies one (folder
 * pick) and by base name otherwise.
 */
function matchBatchFile(src: string, candidates: File[]): File | undefined {
  if (ABSOLUTE.test(src)) return undefined
  let path = src
  try {
    path = decodeURIComponent(src)
  } catch {
    /* keep it encoded */
  }
  path = path.split(/[?#]/)[0].replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/^(\.\.\/)+/, '')
  const base = path.split('/').pop()
  return (
    candidates.find((f) => f.webkitRelativePath && f.webkitRelativePath.endsWith(path)) ??
    candidates.find((f) => f.name === base)
  )
}

/**
 * Pulls a remote or inline image into a File so it can be compressed and
 * stored with the manual. Remote ones go through the server's SSRF-guarded
 * proxy: the browser can't fetch most of them cross-origin anyway.
 */
async function fetchImage(src: string): Promise<File | null> {
  let res: Response
  if (src.startsWith('data:image/')) {
    res = await fetch(src)
  } else if (/^(https?:)?\/\//i.test(src)) {
    const url = src.startsWith('//') ? `https:${src}` : src
    res = await fetch(`/api/import/fetch?url=${encodeURIComponent(url)}`)
  } else {
    return null
  }
  if (!res.ok) return null
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) return null
  return new File([blob], 'embedded', { type: blob.type })
}

/**
 * Stores a markdown file as one page, with every image it shows resolved and
 * compressed as an attachment. The markdown itself is kept byte for byte —
 * rendering maps each address to its stored image instead of rewriting text.
 */
async function prepareMarkdown(
  file: File,
  plan: MarkdownPlan,
  opts: CompressOptions,
  id: string,
  notes: string[],
  onStage?: (label: string) => void,
): Promise<PreparedFile> {
  const page = await prepareOne(file, opts, id)
  const attachments: { src: string; file: PreparedFile }[] = []
  const missing: string[] = []

  for (let i = 0; i < plan.refs.length; i++) {
    const ref = plan.refs[i]
    onStage?.(`正在处理 ${file.name} 里的图片 ${i + 1}/${plan.refs.length}…`)
    try {
      const source = ref.local ?? (await fetchImage(ref.src))
      if (!source) {
        missing.push(ref.src)
        continue
      }
      // Figures and diagrams, not scanned pages: leave their margins alone.
      attachments.push({ src: ref.src, file: await prepareOne(source, { ...opts, trim: false }, `${id}-${i}`) })
    } catch {
      missing.push(ref.src)
    }
  }

  await markDuplicates(attachments.map((a) => a.file))

  const parts = [`${file.name}：markdown`]
  if (attachments.length) parts.push(`嵌入 ${attachments.length} 张图片`)
  if (missing.length) {
    const shown = missing.slice(0, 3).map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s)).join('、')
    parts.push(`${missing.length} 张找不到（${shown}${missing.length > 3 ? ' 等' : ''}），会显示成图片说明文字`)
  }
  notes.push(parts.join('，'))

  return { ...page, attachments }
}

/**
 * Expands PDFs into page images before compression, when that makes them
 * clearly smaller — see src/lib/pdf.ts for how that is decided.
 */
async function expandPdfs(
  files: File[],
  opts: CompressOptions,
  notes: string[],
  problems: string[],
  onStage?: (label: string) => void,
): Promise<File[]> {
  const out: File[] = []

  for (const file of files) {
    if (!isPdf(file)) {
      out.push(file)
      continue
    }
    try {
      onStage?.(`正在分析 ${file.name}…`)
      const result = await convertPdf(
        file,
        { mode: opts.pdf, maxEdge: opts.maxEdge, format: opts.format, quality: opts.quality },
        onStage,
      )
      notes.push(`${file.name}：${result.note}`)
      out.push(...(result.files ?? [file]))
    } catch (err) {
      problems.push(`${file.name} 处理失败：${err instanceof Error ? err.message : String(err)}`)
      out.push(file) // fall back to storing the PDF as-is
    }
  }

  return out
}

/** Long edge of the copy the strip splitter scans. */
const SPLIT_OVERVIEW_EDGE = 4000

/**
 * Slices over-long images into page-sized pieces before compression. A long
 * screenshot-style manual (750 × 12000) scaled to a 1600px long edge would be
 * 100px wide — the same trap as a flat-exported leaflet PDF, with the same fix.
 * Pieces are cut at native resolution; the compressor sizes them afterwards.
 */
async function expandLongImages(
  files: File[],
  notes: string[],
  onStage?: (label: string) => void,
): Promise<File[]> {
  const out: File[] = []
  for (const file of files) {
    if (!isImage(file) || file.type === 'image/svg+xml') {
      out.push(file)
      continue
    }
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      out.push(file) // undecodable — let the compressor report it
      continue
    }
    try {
      const long = Math.max(bitmap.width, bitmap.height)
      if (long / Math.min(bitmap.width, bitmap.height) <= STRIP_RATIO) {
        out.push(file)
        continue
      }
      onStage?.(`正在切分长图 ${file.name}…`)

      const ratio = Math.min(1, SPLIT_OVERVIEW_EDGE / long)
      const probe = document.createElement('canvas')
      probe.width = Math.max(1, Math.round(bitmap.width * ratio))
      probe.height = Math.max(1, Math.round(bitmap.height * ratio))
      const pctx = probe.getContext('2d', { willReadFrequently: true })
      if (!pctx) throw new Error('无法创建 canvas 上下文')
      pctx.fillStyle = '#ffffff'
      pctx.fillRect(0, 0, probe.width, probe.height)
      pctx.drawImage(bitmap, 0, 0, probe.width, probe.height)
      const slices = planSlices(pctx.getImageData(0, 0, probe.width, probe.height))
      probe.width = probe.height = 0

      if (slices.length <= 1) {
        out.push(file)
        continue
      }

      const base = file.name.replace(/\.[^.]+$/, '')
      const digits = String(slices.length).length
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i]
        const sx = Math.floor(s.x / ratio)
        const sy = Math.floor(s.y / ratio)
        const sw = Math.min(bitmap.width - sx, Math.ceil(s.width / ratio))
        const sh = Math.min(bitmap.height - sy, Math.ceil(s.height / ratio))
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('无法创建 canvas 上下文')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, sw, sh)
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.92))
        canvas.width = canvas.height = 0
        if (!blob) throw new Error(`切分 ${file.name} 失败`)
        const ext = blob.type === 'image/webp' ? 'webp' : 'png'
        out.push(new File([blob], `${base}-${String(i + 1).padStart(digits, '0')}.${ext}`, { type: blob.type }))
      }
      notes.push(`${file.name}：长图切成 ${slices.length} 页`)
    } finally {
      bitmap.close()
    }
  }
  return out
}

export async function prepareFiles(
  files: File[],
  opts: CompressOptions,
  onProgress?: (done: number, total: number) => void,
  onStage?: (label: string) => void,
): Promise<PrepareResult> {
  const prepared: PreparedFile[] = []
  const problems: string[] = []
  const notes: string[] = []
  const titles: string[] = []

  const expanded = await expandPdfs(files, opts, notes, problems, onStage)

  // Images a markdown file refers to become its attachments, not pages of
  // their own — so work out which batch files are spoken for first.
  const plans = new Map<File, MarkdownPlan>()
  const consumed = new Set<File>()
  const markdownFiles = expanded.filter(isMarkdown)
  if (markdownFiles.length > 0) {
    // Only loaded when someone actually uploads markdown.
    const { findImageRefs, firstHeading } = await import('./markdown-refs')
    const images = expanded.filter((f) => !isMarkdown(f) && isImage(f))
    for (const md of markdownFiles) {
      const text = await md.text()
      const refs = findImageRefs(text).map((src) => {
        const local = matchBatchFile(src, images)
        if (local) consumed.add(local)
        return { src, local }
      })
      plans.set(md, { refs })
      const heading = firstHeading(text)
      if (heading) titles.push(heading)
    }
  }

  // Images a markdown file embeds stay whole: they sit inside the document.
  const pageFiles = await expandLongImages(
    expanded.filter((f) => !consumed.has(f)),
    notes,
    onStage,
  )
  const sorted = pageFiles.sort((a, b) => naturalSort(a.name, b.name))

  for (let i = 0; i < sorted.length; i++) {
    const file = sorted[i]
    try {
      const plan = plans.get(file)
      prepared.push(
        plan
          ? await prepareMarkdown(file, plan, opts, String(i), notes, onStage)
          : await prepareOne(file, opts, String(i), notes),
      )
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err))
    }
    onProgress?.(i + 1, sorted.length)
  }

  await markDuplicates(prepared)
  return { prepared, problems, notes, titles }
}

/** Dedupe is an optimisation: a failed probe just means we upload anyway. */
async function markDuplicates(items: PreparedFile[]): Promise<void> {
  if (items.length === 0) return
  try {
    const res = await fetch('/api/files/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: items.map((i) => i.hash) }),
    })
    const { existing } = (await res.json()) as { existing: string[] }
    const known = new Set(existing)
    for (const item of items) item.duplicate = known.has(item.hash)
  } catch {
    /* leave every item marked as new */
  }
}

export async function uploadPrepared(item: PreparedFile, canPresign: boolean): Promise<void> {
  const { blob, mime } = item.processed

  if (canPresign) {
    const signed = await fetch('/api/files/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: item.hash, mime }),
    })
    if (!signed.ok) throw new Error(await errorMessage(signed, '签名失败'))
    const { url, contentType } = (await signed.json()) as { url: string; contentType: string }
    const put = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } })
    if (!put.ok) throw new Error(`直传 R2 失败 (${put.status})，检查存储桶 CORS 是否允许 PUT`)
    return
  }

  // Say so up front rather than sending tens of megabytes to be refused.
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `${item.name} 有 ${(blob.size / 1024 / 1024).toFixed(1)} MB，超过单个文件 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 的上限`,
    )
  }

  const form = new FormData()
  form.append('file', blob, item.name)
  form.append('hash', item.hash)
  // A File's own type can be empty or vague; say exactly what to store it as.
  form.append('mime', mime)
  const res = await fetch('/api/files/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await errorMessage(res, `上传 ${item.name} 失败`))
}

/** A page plus the images it embeds — everything that has to reach storage. */
export function withAttachments(items: PreparedFile[]): PreparedFile[] {
  return items.flatMap((item) => [item, ...(item.attachments ?? []).map((a) => a.file)])
}

/** Uploads everything not already stored, reporting progress as it goes. */
export async function uploadAll(
  items: PreparedFile[],
  canPresign: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  // One image embedded twice, or shared by two markdown files, uploads once.
  const seen = new Set<string>()
  const pending = withAttachments(items).filter((i) => {
    if (i.duplicate || seen.has(i.hash)) return false
    seen.add(i.hash)
    return true
  })
  for (let i = 0; i < pending.length; i++) {
    await uploadPrepared(pending[i], canPresign)
    onProgress?.(i + 1, pending.length)
  }
}

function filePayload(item: PreparedFile) {
  return {
    hash: item.hash,
    key: '',
    mime: item.processed.mime,
    size: item.processed.blob.size,
    width: item.processed.width,
    height: item.processed.height,
    originalSize: item.originalSize,
  }
}

/** Shape the server expects in a manual's `pages` array. */
export function toPagePayload(item: PreparedFile) {
  return {
    ...filePayload(item),
    name: item.name,
    attachments: (item.attachments ?? []).map((a) => ({ ...filePayload(a.file), src: a.src })),
  }
}
