import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE, authEnabled, verifyToken } from '@/lib/auth'
import LoginForm from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  // No password configured, or already signed in — nothing to do here.
  if (!authEnabled()) redirect('/')
  if (await verifyToken((await cookies()).get(COOKIE)?.value)) redirect('/')

  // Only allow same-site redirects, never an absolute URL from the query string.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return <LoginForm next={target} />
}
