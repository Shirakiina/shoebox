'use client'

import { planSlices, STRIP_RATIO } from './split'

/**
 * Turns a PDF into page images, in the browser, so it goes through the same
 * compress + dedupe pipeline as photos — and its pages become first-class:
 * thumbnails, reordering, stitched reading.
 *
 * Whether to do that is decided by size, not by guessing what kind of PDF it
 * is. Scanner apps add an invisible OCR text layer, and Illustrator exports
 * carry megabytes of editing data around a little vector art; a "has text, so
 * keep it" rule left both uncompressed. So a few pages are rendered and
 * encoded, the total is estimated, and the PDF is converted only if that
 * clearly wins.
 *
 * Over-long pages — a folded leaflet exported flat — are split into their
 * panels (src/lib/split.ts) and each rendered on its own, so a 12-panel strip
 * becomes 12 readable pages rather than one unreadable sliver.
 *
 * pdf.js is ~1.5 MB, so it is imported lazily: nobody who only uploads photos
 * ever downloads it.
 */

export type PdfMode = 'auto' | 'always' | 'never'

export type PdfResult = {
  /** Page images to use instead of the PDF, or null to keep the PDF as-is. */
  files: File[] | null
  note: string
}

/** Convert only when the images come out at most this share of the original. */
const WORTH_IT = 0.6
/**
 * A compressed page comes out around 50–300 KB. Far above that per piece and
 * converting is sure to win; far below and it cannot — only the middle ground
 * is worth rendering samples to find out. That keeps a 300-page text PDF from
 * being rendered at all just to learn it should be left alone.
 */
const SURE_WIN_PER_PIECE = 600 * 1024
const NO_WIN_PER_PIECE = 120 * 1024
/** Pieces rendered to estimate the converted size in the middle ground. */
const SAMPLES = 3
/**
 * Long edge of the low-resolution render used to find panel boundaries. pdf.js
 * draws hairlines at least one device pixel wide, so thin panel rules survive.
 */
const OVERVIEW_EDGE = 3000
/**
 * pdf.js runs a page's whole operator list for every render, however small
 * the visible part — the K75 leaflet has 810 000 operators and took 14 s per
 * panel. So neighbouring panels are rendered together as one band and cut
 * apart afterwards, within a canvas size every browser accepts.
 */
const MAX_BAND_PIXELS = 16_000_000
const MAX_BAND_SIDE = 16_000
/** A text layer this dense is worth mentioning when it is about to be lost. */
const TEXT_PER_PAGE = 200

/**
 * pdf.js can sit forever on a file it cannot make sense of — no error, no
 * rejection — which left the upload form stuck on "正在分析" with no way out.
 * Every call is bounded so a bad PDF fails loudly and falls back to being
 * stored as-is.
 */
const OPEN_TIMEOUT_MS = 45_000
// Generous: this catches a hang, not a slow render — a dense vector page can
// legitimately take tens of seconds.
const RENDER_TIMEOUT_MS = 90_000

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what}超时（${Math.round(ms / 1000)}s），这个 PDF 可能太复杂、已损坏或被加密`)),
      ms,
    )
  })
  try {
    return await Promise.race([work, guard])
  } finally {
    clearTimeout(timer!)
  }
}

type PdfjsModule = typeof import('pdfjs-dist')
type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>
type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>

let pdfjsPromise: Promise<PdfjsModule> | null = null

async function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    // Served from public/ by scripts/copy-pdf-worker.mjs — a fixed path, rather
    // than a bundler-hashed asset URL that the worker request failed to load.
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    return pdfjs
  })()
  return pdfjsPromise
}

/** A region of one page to render as one output image, in PDF units (1/72"). */
type Piece = { page: number; x: number; y: number; width: number; height: number }

function formatMb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function newCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  // PDF pages are transparent; without this, scans come out black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return { canvas, ctx }
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

async function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality))
  if (!blob) throw new Error('页面编码失败')
  return blob
}

/** The pieces one page should become: itself, or its panels if it's a strip. */
async function planPage(page: PdfPage, number: number): Promise<Piece[]> {
  const base = page.getViewport({ scale: 1 })
  const whole = { page: number, x: 0, y: 0, width: base.width, height: base.height }
  if (Math.max(base.width, base.height) / Math.min(base.width, base.height) <= STRIP_RATIO) return [whole]

  const scale = OVERVIEW_EDGE / Math.max(base.width, base.height)
  const viewport = page.getViewport({ scale })
  const { canvas, ctx } = newCanvas(viewport.width, viewport.height)
  try {
    await withTimeout(page.render({ canvas, canvasContext: ctx, viewport }).promise, RENDER_TIMEOUT_MS, `分析第 ${number} 页`)
    const slices = planSlices(ctx.getImageData(0, 0, canvas.width, canvas.height))
    return slices.map((s) => ({
      page: number,
      x: s.x / scale,
      y: s.y / scale,
      width: s.width / scale,
      height: s.height / scale,
    }))
  } finally {
    release(canvas)
  }
}

/** Pixel scale that puts a piece's long edge at `maxEdge`, never above 4×. */
function scaleFor(piece: Piece, maxEdge: number): number {
  return Math.min(4, maxEdge / Math.max(piece.width, piece.height))
}

/**
 * Renders `pieces` (in order) and hands each one over as its own canvas.
 * Consecutive pieces of the same page share one render, as long as the band
 * stays within MAX_BAND_PIXELS / MAX_BAND_SIDE.
 */
async function renderPieces(
  doc: PdfDocument,
  pieces: Piece[],
  maxEdge: number,
  each: (canvas: HTMLCanvasElement, index: number) => Promise<void>,
  onBand?: (done: number, total: number) => void,
): Promise<void> {
  let i = 0
  while (i < pieces.length) {
    const first = pieces[i]
    let scale = scaleFor(first, maxEdge)
    let box = { x0: first.x, y0: first.y, x1: first.x + first.width, y1: first.y + first.height }
    let j = i + 1
    while (j < pieces.length && pieces[j].page === first.page) {
      const p = pieces[j]
      const nextScale = Math.min(scale, scaleFor(p, maxEdge))
      const next = {
        x0: Math.min(box.x0, p.x),
        y0: Math.min(box.y0, p.y),
        x1: Math.max(box.x1, p.x + p.width),
        y1: Math.max(box.y1, p.y + p.height),
      }
      const w = (next.x1 - next.x0) * nextScale
      const h = (next.y1 - next.y0) * nextScale
      if (w * h > MAX_BAND_PIXELS || w > MAX_BAND_SIDE || h > MAX_BAND_SIDE) break
      box = next
      scale = nextScale
      j++
    }

    const page = await doc.getPage(first.page)
    const viewport = page.getViewport({ scale, offsetX: -box.x0 * scale, offsetY: -box.y0 * scale })
    const band = newCanvas((box.x1 - box.x0) * scale, (box.y1 - box.y0) * scale)
    try {
      await withTimeout(
        page.render({ canvas: band.canvas, canvasContext: band.ctx, viewport }).promise,
        RENDER_TIMEOUT_MS,
        `渲染第 ${first.page} 页`,
      )
      for (let k = i; k < j; k++) {
        const p = pieces[k]
        const piece = newCanvas(p.width * scale, p.height * scale)
        try {
          piece.ctx.drawImage(
            band.canvas,
            (p.x - box.x0) * scale,
            (p.y - box.y0) * scale,
            p.width * scale,
            p.height * scale,
            0,
            0,
            piece.canvas.width,
            piece.canvas.height,
          )
          await each(piece.canvas, k)
        } finally {
          release(piece.canvas)
        }
      }
    } finally {
      release(band.canvas)
      page.cleanup()
    }
    i = j
    onBand?.(i, pieces.length)
  }
}

async function countText(doc: PdfDocument, pages: number): Promise<number> {
  let characters = 0
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    characters += content.items.reduce((sum, item) => sum + ('str' in item ? item.str.length : 0), 0)
    page.cleanup()
  }
  return characters
}

/** Evenly spread sample of indexes: first, last, and between. */
function sampleIndexes(count: number, want: number): number[] {
  if (count <= want) return [...Array(count).keys()]
  return [...new Set([...Array(want).keys()].map((k) => Math.round((k * (count - 1)) / (want - 1))))]
}

export async function convertPdf(
  file: File,
  opts: { mode: PdfMode; maxEdge: number; format: string; quality: number },
  onStage?: (label: string) => void,
): Promise<PdfResult> {
  if (opts.mode === 'never') return { files: null, note: '按设置原样保存' }

  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  // Without a handler pdf.js waits on this callback indefinitely for an
  // encrypted file instead of rejecting.
  task.onPassword = () => {
    void task.destroy()
  }

  try {
    const doc = await withTimeout(task.promise, OPEN_TIMEOUT_MS, '解析 PDF')

    const pieces: Piece[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      onStage?.(`正在分析 ${file.name} ${n}/${doc.numPages} 页…`)
      const page = await doc.getPage(n)
      pieces.push(...(await planPage(page, n)))
      page.cleanup()
    }
    const split = pieces.length > doc.numPages
    const layout = split ? `${doc.numPages} 页切成 ${pieces.length} 块` : `${pieces.length} 页`

    const textPerPage = (await countText(doc, Math.min(3, doc.numPages))) / Math.min(3, doc.numPages)
    const textNote = textPerPage >= TEXT_PER_PAGE ? '；原有的文字层（可选中的文字）不会保留' : ''

    if (opts.mode === 'auto') {
      const perPiece = file.size / pieces.length
      let verdict: 'convert' | 'keep'
      let estimate: number | null = null
      if (perPiece >= SURE_WIN_PER_PIECE) verdict = 'convert'
      else if (perPiece <= NO_WIN_PER_PIECE) verdict = 'keep'
      else {
        onStage?.(`正在估算 ${file.name} 转成图片后的大小…`)
        const picks = sampleIndexes(pieces.length, SAMPLES)
        let sampled = 0
        for (const i of picks) {
          await renderPieces(doc, [pieces[i]], opts.maxEdge, async (canvas) => {
            sampled += (await encode(canvas, opts.format, opts.quality)).size
          })
        }
        estimate = (sampled / picks.length) * pieces.length
        verdict = estimate <= file.size * WORTH_IT ? 'convert' : 'keep'
      }
      if (verdict === 'keep') {
        return {
          files: null,
          note:
            estimate === null
              ? `平均每页只有 ${formatMb(perPiece)}，转成图片不会更小，原样保存`
              : `转成图片预计 ${formatMb(estimate)}，比原文件 ${formatMb(file.size)} 省不了多少，原样保存`,
        }
      }
    }

    const base = file.name.replace(/\.pdf$/i, '')
    const digits = String(pieces.length).length
    const files: File[] = new Array(pieces.length)
    await renderPieces(
      doc,
      pieces,
      opts.maxEdge,
      async (canvas, i) => {
        // Near-lossless intermediate; the page compressor makes the real cut.
        // PNG would be several times larger and a long PDF is held in memory.
        const blob = await encode(canvas, 'image/webp', 0.92)
        const ext = blob.type === 'image/webp' ? 'webp' : 'png'
        files[i] = new File([blob], `${base}-${String(i + 1).padStart(digits, '0')}.${ext}`, { type: blob.type })
      },
      (done, total) => onStage?.(`正在拆分 ${file.name} ${done}/${total}…`),
    )

    const reason = opts.mode === 'always' ? '按设置拆成图片' : '转成图片更小'
    return { files, note: `${reason}，${layout}${textNote}` }
  } finally {
    await task.destroy()
  }
}
