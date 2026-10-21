import { NextResponse } from 'next/server'
import { createManual, listManuals, type IncomingPage } from '@/lib/db'
import { resolvePages } from '@/lib/resolve-pages'
import { newId } from '@/lib/ids'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? undefined
  return NextResponse.json({ manuals: listManuals(q) })
}

type Payload = {
  title?: string
  category?: string
  keywords?: string
  notes?: string
  pages?: IncomingPage[]
}

export async function POST(req: Request) {
  const body = (await req.json()) as Payload
  const title = body.title?.trim()
  if (!title) return NextResponse.json({ error: '标题不能为空' }, { status: 400 })

  const resolved = await resolvePages(Array.isArray(body.pages) ? body.pages : [])
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }

  const id = newId()
  createManual(
    {
      id,
      title,
      category: body.category,
      keywords: body.keywords,
      notes: body.notes,
    },
    resolved.pages,
  )
  return NextResponse.json({ id })
}
