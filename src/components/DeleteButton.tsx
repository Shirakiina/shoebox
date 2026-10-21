'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function DeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!confirm(`删除《${title}》？其他资料没有引用的文件会一并删除。`)) return
    setBusy(true)
    const res = await fetch(`/api/manuals/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      alert('删除失败')
      setBusy(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <button className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>
      {busy ? '删除中…' : '删除'}
    </button>
  )
}
