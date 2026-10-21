import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, authEnabled, verifyToken } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next()
  if (await verifyToken(req.cookies.get(COOKIE)?.value)) return NextResponse.next()

  const { pathname, search } = req.nextUrl

  // API callers get a status they can act on; browsers get the login page.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = {
  // pdf.worker.min.mjs is a public library file with no user data in it, and a
  // Worker request that gets redirected to /login just fails silently.
  matcher: [
    '/((?!login|api/auth/|_next/static|_next/image|favicon.ico|pdf\\.worker\\.min\\.mjs).*)',
  ],
}
