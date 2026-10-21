/**
 * Shared by the server and the upload form, so it lives outside db.ts —
 * importing that into a client component would drag node:sqlite along.
 */

/** Accepts commas, ideographic commas, semicolons or whitespace as separators. */
export function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,，、;；\s]+/)) {
    const word = part.trim()
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push(word)
  }
  return out
}

export function normalizeKeywords(raw: string | null | undefined): string | null {
  const words = parseKeywords(raw)
  return words.length ? words.join(', ') : null
}
