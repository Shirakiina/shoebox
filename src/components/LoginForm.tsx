'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { errorMessage } from '@/lib/http'

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        setError(await errorMessage(res, '登录失败'))
        setPassword('')
        return
      }
      router.replace(next)
      router.refresh()
    } catch {
      setError('网络错误')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-mark" aria-hidden>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H10a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4Z" />
            <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H14a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20Z" />
          </svg>
        </div>

        <h1 className="auth-title">鞋盒</h1>
        <p className="auth-hint">私有站点，请输入密码</p>

        <form onSubmit={submit} className="auth-form">
          <div className={`auth-field${error ? ' invalid' : ''}`}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="4" y="10.5" width="16" height="10" rx="2.2" />
              <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1" />
            </svg>
            <input
              type="password"
              value={password}
              autoFocus
              autoComplete="current-password"
              placeholder="密码"
              aria-label="密码"
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
              // Password managers rewrite this node before hydration.
              suppressHydrationWarning
            />
          </div>

          <p className={`auth-error${error ? ' show' : ''}`} role="alert">
            {error ?? ' '}
          </p>

          <button className="auth-submit" type="submit" disabled={busy || !password}>
            {busy ? '验证中…' : '进入'}
          </button>
        </form>
      </div>
    </div>
  )
}
