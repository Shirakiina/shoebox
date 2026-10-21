import { NextResponse } from 'next/server'
import { knownHashes } from '@/lib/db'
import { HASH_RE } from '@/lib/ids'

export const runtime = 'nodejs'

/** Dedupe probe: tell the client which blobs it can skip uploading. */
export async function POST(req: Request) {
  const body = (await req.json()) as { hashes?: unknown }
  const hashes = Array.isArray(body.hashes)
    ? body.hashes.filter((h): h is string => typeof h === 'string' && HASH_RE.test(h))
    : []
  return NextResponse.json({ existing: [...knownHashes(hashes)] })
}
