import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, MAX_AGE, authEnabled, issueToken, passwordMatches } from '@/lib/auth'

export const runtime = 'nodejs'

const MAX_ATTEMPTS = 8
const LOCKOUT_MS = 60_000
const attempts = new Map<string, { count: number; lockedUntil: number }>()

function clientKey(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local'
}

export async function POST(req: NextRequest) {
  if (!authEnabled()) {
    return NextResponse.json({ error: '服务端未设置 APP_PASSWORD' }, { status: 400 })
  }

  const key = clientKey(req)
  const record = attempts.get(key)
  if (record && record.lockedUntil > Date.now()) {
    const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000)
    return NextResponse.json({ error: `尝试过多，请 ${seconds} 秒后再试` }, { status: 429 })
  }

  const { password } = (await req.json().catch(() => ({}))) as { password?: string }

  if (!password || !(await passwordMatches(password))) {
    const count = (record?.count ?? 0) + 1
    attempts.set(key, {
      count,
      lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
    })
    // Blunt the brute-force rate without holding a real limiter.
    await new Promise((r) => setTimeout(r, 400))
    return NextResponse.json({ error: '密码不对' }, { status: 401 })
  }

  attempts.delete(key)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, await issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
    secure: new URL(req.url).protocol === 'https:',
  })
  return res
}
