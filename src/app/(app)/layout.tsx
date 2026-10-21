import Link from 'next/link'
import { authEnabled } from '@/lib/auth'
import LogoutButton from '@/components/LogoutButton'
import ThemeToggle from '@/components/ThemeToggle'

/** Chrome for the signed-in app. /login sits outside this group and renders bare. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="inner">
          <Link href="/" className="brand">
            鞋<span>盒</span>
          </Link>
          <nav className="nav">
            <ThemeToggle />
            <Link href="/" className="btn btn-sm">
              全部
            </Link>
            <Link href="/upload" className="btn btn-sm btn-primary">
              + 添加
            </Link>
            {authEnabled() ? <LogoutButton /> : null}
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  )
}
