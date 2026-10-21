import { findContentBox, type Box, type Pixels } from './trim'

/**
 * Cuts an over-long page into pieces that read well on their own.
 *
 * A folded leaflet exported flat is one page many times wider than tall — the
 * K75 keyboard manual is 1665 × 201 mm, twelve panels side by side. Rendered
 * to a 1600px long edge that is a 1600 × 193 sliver nobody can read. Split into
 * its panels and stacked, it reads panel by panel like the paper original.
 *
 * Tall strips (e-commerce style long images) are sliced too; the reader joins
 * pages seamlessly, so there the cut positions only need to avoid text.
 *
 * Pure function over RGBA pixels — see scripts/split-check.mjs.
 */

/** Long edge over short edge above which a page is treated as a strip. */
export const STRIP_RATIO = 2.2

export type Slice = { x: number; y: number; width: number; height: number }

type Options = { whiteLevel?: number }

function isInk(data: Pixels['data'], o: number, white: number): boolean {
  if (data[o + 3] < 16) return false
  return data[o] < white || data[o + 1] < white || data[o + 2] < white
}

/** Share of non-background pixels in each column (or row) within a box. */
function profile(img: Pixels, box: Box, axis: 'x' | 'y', white: number): Float32Array {
  const { data, width } = img
  const length = axis === 'x' ? box.width : box.height
  const across = axis === 'x' ? box.height : box.width
  const out = new Float32Array(length)
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      if (!isInk(data, (y * width + x) * 4, white)) continue
      out[axis === 'x' ? x - box.x : y - box.y]++
    }
  }
  for (let i = 0; i < length; i++) out[i] /= across
  return out
}

/**
 * Positions that look like a deliberate boundary between panels: a thin line
 * running the full content height (the K75's panel rules), or a clean empty
 * band (a white gutter). Internal artwork — table borders, drawings — rarely
 * spans the whole height, so it is not mistaken for either.
 */
function separators(p: Float32Array, span: number): number[] {
  const maxRule = Math.max(3, Math.round(span * 0.004))
  const minGap = Math.max(4, Math.round(span * 0.004))
  const found: number[] = []
  let i = 0
  while (i < p.length) {
    if (p[i] >= 0.9) {
      const start = i
      while (i < p.length && p[i] >= 0.9) i++
      if (i - start <= maxRule) found.push((start + i - 1) / 2)
      continue
    }
    if (p[i] <= 0.003) {
      const start = i
      while (i < p.length && p[i] <= 0.003) i++
      if (i - start >= minGap) found.push((start + i - 1) / 2)
      continue
    }
    i++
  }
  return found
}

/** The ink profile averaged over a small window, via prefix sums. */
function smoother(p: Float32Array): (i: number) => number {
  const radius = Math.max(2, Math.round(p.length * 0.004))
  const prefix = new Float64Array(p.length + 1)
  for (let i = 0; i < p.length; i++) prefix[i + 1] = prefix[i] + p[i]
  return (i) => {
    const a = Math.max(0, i - radius)
    const b = Math.min(p.length, i + radius + 1)
    return (prefix[b] - prefix[a]) / (b - a)
  }
}

/**
 * Cuts the profile into about-even pieces without being told how many.
 *
 * Every piece count whose width falls in [minSize, maxSize] is tried; each cut
 * is nudged to the quietest spot near its even position, and the count whose
 * worst cut is cleanest wins — near-ties go to the count closest to `target`.
 * Quietness is judged on a smoothed profile: the thin blank line between two
 * lines of type is quiet too, but the wide gap between columns or paragraphs
 * is where a reader would cut.
 */
function evenCuts(p: Float32Array, target: number, minSize: number, maxSize: number): number[] {
  const quiet = smoother(p)
  const fewest = Math.max(1, Math.round(p.length / maxSize))
  const most = Math.max(fewest, Math.round(p.length / minSize))
  const goal = Math.max(1, Math.round(p.length / target))

  let best: { cuts: number[]; cost: number; count: number } | null = null
  for (let count = fewest; count <= most; count++) {
    const step = p.length / count
    const cuts: number[] = []
    let cost = 0
    for (let k = 1; k < count; k++) {
      const from = Math.max(0, Math.floor(k * step - step * 0.2))
      const to = Math.min(p.length - 1, Math.ceil(k * step + step * 0.2))
      let at = Math.round(k * step)
      for (let i = from; i <= to; i++) if (quiet(i) < quiet(at) - 1e-9) at = i
      cuts.push(at)
      cost = Math.max(cost, quiet(at))
    }
    const better =
      !best ||
      cost < best.cost - 0.01 ||
      (cost <= best.cost + 0.01 && Math.abs(count - goal) < Math.abs(best.count - goal))
    if (better) best = { cuts, cost, count }
  }
  return best?.cuts ?? []
}

function toSlices(box: Box, cuts: number[], axis: 'x' | 'y'): Slice[] {
  const length = axis === 'x' ? box.width : box.height
  const edges = [0, ...cuts.map(Math.round), length]
  const out: Slice[] = []
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k]
    const b = edges[k + 1]
    if (b - a < 2) continue
    out.push(
      axis === 'x'
        ? { x: box.x + a, y: box.y, width: b - a, height: box.height }
        : { x: box.x, y: box.y + a, width: box.width, height: b - a },
    )
  }
  return out
}

/**
 * Pieces to render for one page, in reading order, in the image's pixel
 * coordinates. A page of ordinary proportions comes back as a single piece.
 */
export function planSlices(img: Pixels, options: Options = {}): Slice[] {
  const white = options.whiteLevel ?? 235
  const whole: Slice = { x: 0, y: 0, width: img.width, height: img.height }
  if (Math.max(img.width, img.height) / Math.min(img.width, img.height) <= STRIP_RATIO) return [whole]

  // Work inside the content so the page's outer margins neither count as a
  // gutter nor end up as blank slivers.
  const content = findContentBox(img, { whiteLevel: white, padding: 0 })
  if (!content) return [whole]

  if (img.width >= img.height) {
    const p = profile(img, content, 'x', white)
    // A rule on the very edge is the leaflet's outer frame, not a boundary.
    const edge = Math.max(3, content.width * 0.01)
    let cuts = separators(p, content.width).filter((c) => c > edge && c < content.width - edge)

    // Drop pieces too narrow to be a panel: merge them into the previous one.
    const minWidth = content.height * 0.3
    cuts = cuts.filter((c, k) => c - (k === 0 ? 0 : cuts[k - 1]) >= minWidth)
    if (cuts.length && content.width - cuts[cuts.length - 1] < minWidth) cuts.pop()

    // Nothing drawn between panels: fall back to pieces of a page-like width.
    if (cuts.length === 0) {
      const h = content.height
      cuts = evenCuts(p, h * 0.8, h * 0.4, h * 1.5)
    }
    return toSlices(content, cuts, 'x')
  }

  // Tall strip: the reader re-joins slices without a seam, so any cut that
  // avoids a line of text is as good as another.
  const p = profile(img, content, 'y', white)
  const w = content.width
  return toSlices(content, evenCuts(p, w * 1.3, w * 0.8, w * 2), 'y')
}
