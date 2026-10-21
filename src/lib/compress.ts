'use client'

import type { PdfMode } from './pdf'
import { sha256Hex } from './sha256'
import { planTrim, type Box } from './trim'
import { MARKDOWN_MIME, isMarkdownName, normalizeMime } from './mime'

export type CompressOptions = {
  /** Longest edge in px after resizing. 1600 keeps small print legible. */
  maxEdge: number
  /** 0–1 encoder quality. */
  quality: number
  /** Scanned black-on-white pages compress ~30% better in grayscale. */
  grayscale: boolean
  format: 'image/webp' | 'image/jpeg'
  /** What to do with PDFs — see src/lib/pdf.ts. */
  pdf: PdfMode
  /** Cut away white page margins before resizing — see src/lib/trim.ts. */
  trim: boolean
}

export const DEFAULT_OPTIONS: CompressOptions = {
  maxEdge: 1600,
  quality: 0.75,
  grayscale: false,
  format: 'image/webp',
  pdf: 'auto',
  trim: true,
}

export type ProcessedFile = {
  blob: Blob
  mime: string
  width: number | null
  height: number | null
  originalSize: number
  originalName: string
  /** White margins were detected and cut away. */
  trimmed: boolean
  /** Why an image was stored untouched instead of compressed, if it was. */
  keptAsIs?: string
}

export function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function isMarkdown(file: File): boolean {
  // Browsers disagree on the type (text/markdown, text/x-markdown, or empty),
  // so the extension is the reliable signal.
  return file.type === MARKDOWN_MIME || file.type === 'text/x-markdown' || isMarkdownName(file.name)
}

/**
 * createImageBitmap cannot take an SVG in Chrome, and documentation leans on
 * SVG for diagrams. Going through an <img> rasterises it; an SVG with no
 * intrinsic size gets a usable default instead of 0×0.
 */
async function decodeSvg(file: File): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const width = img.naturalWidth || 1200
    const height = img.naturalHeight || Math.round(width * 0.75)
    return await createImageBitmap(img, { resizeWidth: width, resizeHeight: height })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Any other file: stored byte for byte, shown as a download. */
function asIs(file: File, keptAsIs?: string): ProcessedFile {
  return {
    blob: file,
    mime: normalizeMime(file.type),
    width: null,
    height: null,
    originalSize: file.size,
    originalName: file.name,
    trimmed: false,
    keptAsIs,
  }
}

/**
 * Downscale + re-encode in the browser. A phone photo of a manual page goes
 * from ~3 MB to ~150 KB, which is the single biggest win in the pipeline.
 * PDFs reaching this function are kept as-is; splitting a scanned PDF into
 * page images happens earlier, in the ingest pipeline.
 */
export async function processFile(file: File, opts: CompressOptions): Promise<ProcessedFile> {
  if (isPdf(file)) {
    return {
      blob: file,
      mime: 'application/pdf',
      width: null,
      height: null,
      originalSize: file.size,
      originalName: file.name,
      trimmed: false,
    }
  }

  // Stored as the exact bytes uploaded: the hash, and so dedupe, depends on it.
  if (isMarkdown(file)) {
    return {
      blob: new Blob([file], { type: MARKDOWN_MIME }),
      mime: MARKDOWN_MIME,
      width: null,
      height: null,
      originalSize: file.size,
      originalName: file.name,
      trimmed: false,
    }
  }

  if (!isImage(file)) return asIs(file)

  let bitmap: ImageBitmap
  try {
    bitmap = file.type === 'image/svg+xml' ? await decodeSvg(file) : await createImageBitmap(file)
  } catch {
    // Chrome/Firefox cannot decode HEIC; Safari can. Keep it rather than
    // refuse it — it just can't be previewed here.
    return asIs(file, '浏览器解不了这张图（HEIC 可以先转成 JPEG），原样保存，只能下载')
  }

  // Crop first, then resize: the content, not the white paper around it, gets
  // the maxEdge resolution budget.
  const source = (opts.trim && detectContent(bitmap)) || {
    x: 0,
    y: 0,
    width: bitmap.width,
    height: bitmap.height,
  }
  const trimmed = source.width !== bitmap.width || source.height !== bitmap.height

  const scale = Math.min(1, opts.maxEdge / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')

  // White backdrop so transparent PNGs don't turn black under JPEG/WebP.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  if (opts.grayscale) ctx.filter = 'grayscale(1)'
  ctx.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height)
  ctx.filter = 'none'
  bitmap.close()

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, opts.format, opts.quality),
  )
  if (!blob) throw new Error(`编码失败：${file.name}`)

  // Some browsers silently fall back to PNG when WebP is unsupported.
  const mime = blob.type || opts.format

  return {
    blob,
    mime,
    width,
    height,
    originalSize: file.size,
    originalName: file.name,
    trimmed,
  }
}

/** Longest edge of the copy the margin detector scans — plenty for finding edges. */
const DETECT_EDGE = 800

/**
 * Runs the margin detector on a downscaled copy and maps the box back to the
 * bitmap's own coordinates. Returns null when there is nothing worth cutting.
 */
function detectContent(bitmap: ImageBitmap): Box | null {
  const ratio = Math.min(1, DETECT_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * ratio))
  const h = Math.max(1, Math.round(bitmap.height * ratio))

  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const ctx = probe.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(bitmap, 0, 0, w, h)
  const box = planTrim(ctx.getImageData(0, 0, w, h))
  probe.width = 0
  probe.height = 0

  if (!box) return null

  const x = Math.floor(box.x / ratio)
  const y = Math.floor(box.y / ratio)
  return {
    x,
    y,
    width: Math.min(bitmap.width - x, Math.ceil(box.width / ratio)),
    height: Math.min(bitmap.height - y, Math.ceil(box.height / ratio)),
  }
}

/**
 * crypto.subtle only exists in a secure context, so on a plain-HTTP LAN origin
 * (http://192.168.x.x:3000) it is undefined and every upload used to fail.
 * Fall back to the JS implementation there — the hashes are identical, which
 * matters because the server recomputes and rejects a mismatch.
 */
export async function sha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()

  if (crypto?.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  return sha256Hex(new Uint8Array(buffer))
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Sort "page2.jpg" before "page10.jpg" the way a human would. */
export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
