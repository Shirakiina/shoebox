import { NextResponse } from 'next/server'
import { deleteManual, getManual, getPages, updateManual, type EditableMeta } from '@/lib/db'
import { getStorage } from '@/lib/storage'

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const manual = getManual(id)
  if (!manual) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ manual, pages: getPages(id) })
}

/** Edits metadata in place; pages and stored blobs are untouched. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const current = getManual(id)
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Partial<EditableMeta>
  const title = (body.title ?? current.title)?.trim()
  if (!title) return NextResponse.json({ error: '标题不能为空' }, { status: 400 })

  // Absent keys keep their current value, so a partial body is safe.
  const pick = (key: 'category' | 'keywords' | 'notes') =>
    body[key] !== undefined ? body[key] : (current[key] ?? undefined)

  updateManual(id, {
    title,
    category: pick('category'),
    keywords: pick('keywords'),
    notes: pick('notes'),
  })

  return NextResponse.json({ manual: getManual(id) })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!getManual(id)) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Only blobs no other manual points at are removed from storage.
  const orphaned = deleteManual(id)
  const storage = getStorage()
  await Promise.allSettled(orphaned.map((key) => storage.remove(key)))

  return NextResponse.json({ deleted: id, blobsRemoved: orphaned.length })
}
