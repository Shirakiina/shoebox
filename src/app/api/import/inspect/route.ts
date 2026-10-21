import { NextResponse } from 'next/server'
import { safeFetch } from '@/lib/safe-fetch'

export const runtime = 'nodejs'

const MAX_HTML_BYTES = 5 * 1024 * 1024
const MAX_IMAGES = 200

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function pickTitle(html: string): string {
  for (const re of [
    /<h[14][^>]*id=["']pageTitle["'][^>]*>([\s\S]*?)<\/h[14]>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]) {
    const m = html.match(re)
    if (m) {
      const text = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim()
      if (text) return text.slice(0, 120)
    }
  }
  return ''
}

/**
 * Reads a manual published as a web page and reports the images it contains,
 * in document order. Nothing is downloaded here beyond the HTML — the browser
 * pulls each image through /api/import/fetch so it goes through the same
 * compress + dedupe pipeline as a manual upload.
 */
export async function POST(req: Request) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string }
  if (!url?.trim()) return NextResponse.json({ error: '请输入网址' }, { status: 400 })

  let page
  try {
    page = await safeFetch(url.trim(), { maxBytes: MAX_HTML_BYTES, accept: /^text\/html|xhtml/ })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const html = page.body.toString('utf8')
  const base = new URL(page.url)

  const seen = new Set<string>()
  const images: string[] = []
  for (const match of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const raw = decodeEntities(match[1]).trim()
    if (!raw || raw.startsWith('data:')) continue
    let absolute: string
    try {
      absolute = new URL(raw, base).toString()
    } catch {
      continue
    }
    if (seen.has(absolute)) continue
    seen.add(absolute)
    images.push(absolute)
    if (images.length >= MAX_IMAGES) break
  }

  return NextResponse.json({
    title: pickTitle(html),
    sourceUrl: page.url,
    images,
  })
}
