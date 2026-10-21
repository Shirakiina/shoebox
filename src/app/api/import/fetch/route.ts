import { NextResponse } from 'next/server'
import { safeFetch } from '@/lib/safe-fetch'

export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/**
 * Proxies one remote image to the browser, which cannot fetch it directly
 * across origins. Content-Type is enforced here, which also filters out the
 * tracking pixels and analytics beacons that sit among the real <img> tags.
 */
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url')
  if (!target) return NextResponse.json({ error: 'missing url' }, { status: 400 })

  try {
    const { body, contentType } = await safeFetch(target, {
      maxBytes: MAX_IMAGE_BYTES,
      accept: /^image\//,
    })
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
