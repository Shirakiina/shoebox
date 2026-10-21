import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT } from '@/components/ThemeToggle'
import './globals.css'

export const metadata: Metadata = {
  title: '鞋盒 Shoebox',
  description: '说明书、发票、名片、合同……把要留一份的文件都收进来',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions (password managers, Grammarly, dark-mode tools) commonly
    // add attributes to <html>/<body> before React hydrates. Suppressing here is
    // scoped to these two nodes and does not hide mismatches inside the app.
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before the first paint, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
