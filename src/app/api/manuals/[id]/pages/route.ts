import { NextResponse } from 'next/server'
import { getManual, getPages, replacePages, type IncomingPage } from '@/lib/db'
import { resolvePages } from '@/lib/resolve-pages'
import { getStorage } from '@/lib/storage'

export const runtime = 'nodejs'

/**
 * Replaces the manual's pages with the supplied ordered list — one endpoint
 * covers reordering, removal and appending. Blobs left unreferenced afterwards
 * are deleted from storage, exactly as when a whole manual is removed.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!getManual(id)) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { pages?: IncomingPage[] }
  const resolved = await resolvePages(Array.isArray(body.pages) ? body.pages : [])
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  const orphaned = replacePages(id, resolved.pages)
  const storage = getStorage()
  await Promise.allSettled(orphaned.map((key) => storage.remove(key)))

  return NextResponse.json({ pages: getPages(id), blobsRemoved: orphaned.length })
}
