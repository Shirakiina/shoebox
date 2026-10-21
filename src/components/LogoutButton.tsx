'use client'

import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()
  return (
    <button
      className="btn btn-sm"
      title="退出登录"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        router.replace('/login')
        router.refresh()
      }}
    >
      退出
    </button>
  )
}
