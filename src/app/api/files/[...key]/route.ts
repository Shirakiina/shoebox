import { NextResponse } from 'next/server'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { resolveKey } from '@/lib/storage/local'
import { attachmentDisposition } from '@/lib/storage'

export const runtime = 'nodejs'

const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
}

/**
 * Serves blobs written by the local driver. Unused when STORAGE_DRIVER=r2.
 *
 * Only the page types above are served as themselves. Everything else — the
 * arbitrary files a library entry can hold, stored as .bin — goes out as an
 * opaque download, so an uploaded HTML or SVG can never run on this origin.
 * `?name=` asks for a download under the original file name.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params
  let full: string
  try {
    full = resolveKey(key.join('/'))
  } catch {
    return NextResponse.json({ error: 'bad key' }, { status: 400 })
  }

  let size: number
  try {
    const info = await stat(full)
    if (!info.isFile()) throw new Error('not a file')
    size = info.size
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const type = TYPES[extname(full).toLowerCase()]
  const name = new URL(req.url).searchParams.get('name')
  const headers: Record<string, string> = {}
  if (name) headers['Content-Disposition'] = attachmentDisposition(name.slice(0, 200))
  else if (!type) headers['Content-Disposition'] = 'attachment'

  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream
  return new Response(stream, {
    headers: {
      ...headers,
      'Content-Type': type ?? 'application/octet-stream',
      'Content-Length': String(size),
      // User-uploaded bytes: never let the browser sniff them into HTML.
      'X-Content-Type-Options': 'nosniff',
      // Keys are content hashes, so the bytes behind one never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
