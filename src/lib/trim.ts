/**
 * Finds the region of a page that actually has something on it, so the white
 * margins can be cut away before compression.
 *
 * Scanner apps like to drop a landscape photo onto an A4 portrait page: the
 * manual ends up occupying 30–40% of the height, and in the stitched reader
 * every page turns into content, blank, blank, content. Trimming fixes the
 * reading experience and gives the real content the full resolution budget.
 *
 * Pure function over RGBA pixels, so it runs the same in the browser and in
 * the Node test harness (scripts/trim-check.mjs).
 */

export type Pixels = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

export type Box = { x: number; y: number; width: number; height: number }

export type TrimOptions = {
  /** A pixel counts as background when every channel is at least this bright. */
  whiteLevel?: number
  /**
   * A row or column counts as content once this share of its pixels is not
   * background. Looking at the share rather than "any pixel" means a speck of
   * dust or JPEG noise in the margin does not stop the trim.
   */
  inkRatio?: number
  /** Margin kept around the content, as a share of the page's short edge. */
  padding?: number
}

const DEFAULTS: Required<TrimOptions> = {
  whiteLevel: 235,
  inkRatio: 0.005,
  padding: 0.02,
}

/** Content bounding box, or null for a blank page. */
export function findContentBox(img: Pixels, options: TrimOptions = {}): Box | null {
  const { whiteLevel, inkRatio, padding } = { ...DEFAULTS, ...options }
  const { data, width, height } = img

  const rowInk = new Uint32Array(height)
  const colInk = new Uint32Array(width)

  for (let y = 0; y < height; y++) {
    let offset = y * width * 4
    for (let x = 0; x < width; x++, offset += 4) {
      // Fully transparent pixels are background whatever their colour.
      if (data[offset + 3] < 16) continue
      if (data[offset] >= whiteLevel && data[offset + 1] >= whiteLevel && data[offset + 2] >= whiteLevel) {
        continue
      }
      rowInk[y]++
      colInk[x]++
    }
  }

  const rowMin = Math.max(1, Math.ceil(width * inkRatio))
  const colMin = Math.max(1, Math.ceil(height * inkRatio))

  let top = 0
  while (top < height && rowInk[top] < rowMin) top++
  if (top === height) return null // nothing on the page

  let bottom = height - 1
  while (bottom > top && rowInk[bottom] < rowMin) bottom--

  let left = 0
  while (left < width && colInk[left] < colMin) left++
  let right = width - 1
  while (right > left && colInk[right] < colMin) right--

  const pad = Math.round(Math.min(width, height) * padding)
  const x = Math.max(0, left - pad)
  const y = Math.max(0, top - pad)
  return {
    x,
    y,
    width: Math.min(width, right + pad + 1) - x,
    height: Math.min(height, bottom + pad + 1) - y,
  }
}

/**
 * A margin is only cut when it is a real band of empty paper. Ordinary page
 * margins (5–10% on a printed manual) stay: cutting them changes how far the
 * reader zooms the page, so text size would jump from page to page, and it is
 * not what makes a page look wrong in the first place.
 */
const MIN_BAND = 0.12

/**
 * Where to crop, deciding each side on its own, or null when nothing is worth
 * cutting. The scanner-app page — a landscape photo centred on an A4 portrait
 * sheet — loses its top and bottom bands and keeps its full width.
 */
export function planTrim(img: Pixels, options: TrimOptions = {}): Box | null {
  const { padding } = { ...DEFAULTS, ...options }
  const content = findContentBox(img, { ...options, padding: 0 })
  if (!content) return null

  const { width: W, height: H } = img
  const pad = Math.round(Math.min(W, H) * padding)

  const left = content.x
  const top = content.y
  const right = content.x + content.width
  const bottom = content.y + content.height

  const x0 = left >= W * MIN_BAND ? Math.max(0, left - pad) : 0
  const x1 = W - right >= W * MIN_BAND ? Math.min(W, right + pad) : W
  const y0 = top >= H * MIN_BAND ? Math.max(0, top - pad) : 0
  const y1 = H - bottom >= H * MIN_BAND ? Math.min(H, bottom + pad) : H

  if (x0 === 0 && y0 === 0 && x1 === W && y1 === H) return null

  // A crop keeping almost nothing is more likely a faint mark on an empty page
  // than a real page — leave it alone.
  if (((x1 - x0) * (y1 - y0)) / (W * H) < 0.05) return null

  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
