import { NextResponse } from 'next/server'
import { getStorage, keyForHash } from '@/lib/storage'
import { HASH_RE } from '@/lib/ids'
import { normalizeMime, storageContentType } from '@/lib/mime'

export const runtime = 'nodejs'

/** Hand the browser a short-lived URL so bytes go straight to R2. */
export async function POST(req: Request) {
  const storage = getStorage()
  if (!storage.supportsPresign) {
    return NextResponse.json({ error: `driver "${storage.name}" has no presign` }, { status: 400 })
  }

  const body = (await req.json()) as { hash?: string; mime?: string }
  const hash = body.hash
  if (!hash || !HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'missing or malformed hash' }, { status: 400 })
  }
  const mime = normalizeMime(body.mime)

  const key = keyForHash(hash, mime)
  // The signature covers Content-Type, so the browser must PUT with exactly
  // this one — which for arbitrary files is not the type it claimed.
  return NextResponse.json({
    key,
    url: await storage.presignPut(key, mime),
    contentType: storageContentType(mime),
  })
}
