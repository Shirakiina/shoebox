import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getStorage, keyForHash } from '@/lib/storage'
import { HASH_RE } from '@/lib/ids'
import { MAX_UPLOAD_BYTES } from '@/lib/limits'
import { normalizeMime } from '@/lib/mime'

export const runtime = 'nodejs'

const tooLarge = () =>
  NextResponse.json({ error: `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` }, { status: 413 })

/**
 * Upload path for the local driver (and a fallback for R2 when the bucket has
 * no CORS rule yet). The bytes go through this server; with R2 configured the
 * browser normally PUTs straight to the bucket instead — see ../presign.
 */
export async function POST(req: Request) {
  // Refuse early, before buffering: allow a little for multipart overhead.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + 1024 * 1024) return tooLarge()

  // A body cut short (by a size limit, or a dropped connection) fails here.
  // Unhandled, that became an empty 500 and the browser saw only
  // "Unexpected end of JSON input".
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '上传的数据不完整，可能是文件太大或网络中断' }, { status: 400 })
  }
  const file = form.get('file')
  const claimedHash = form.get('hash')

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 })
  }
  if (typeof claimedHash !== 'string' || !HASH_RE.test(claimedHash)) {
    return NextResponse.json({ error: 'missing or malformed hash' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge()

  const buf = Buffer.from(await file.arrayBuffer())
  const actual = createHash('sha256').update(buf).digest('hex')
  if (actual !== claimedHash) {
    return NextResponse.json({ error: 'hash mismatch' }, { status: 400 })
  }

  const mime = normalizeMime(form.get('mime')?.toString() || file.type)
  const key = keyForHash(actual, mime)
  await getStorage().put(key, buf, mime)

  return NextResponse.json({ key, hash: actual, size: buf.length, mime })
}
