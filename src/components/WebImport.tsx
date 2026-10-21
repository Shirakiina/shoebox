'use client'

import { useState } from 'react'
import { errorMessage } from '@/lib/http'

export type Inspected = { title: string; sourceUrl: string; images: string[] }

/**
 * Pulls a manual published as a web page into the normal ingest flow: inspect
 * the page, then hand the images back as Files so the caller can run them
 * through the same compress + dedupe pipeline as a manual upload.
 */
/**
 * Manual pages are never this small. Analytics beacons on these pages are often
 * served as a real 1x1 image/jpeg, so Content-Type alone does not filter them —
 * the dimensions do.
 */
const MIN_EDGE = 100

async function isRealPage(blob: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(blob)
    const big = bitmap.width >= MIN_EDGE && bitmap.height >= MIN_EDGE
    bitmap.close()
    return big
  } catch {
    return false // undecodable: let it go rather than break the import
  }
}

export default function WebImport({
  onImported,
}: {
  onImported: (files: File[], info: Inspected) => void | Promise<void>
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(0)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return

    setBusy('正在读取网页…')
    setError(null)
    setSkipped(0)

    try {
      const res = await fetch('/api/import/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) throw new Error(await errorMessage(res, '读取网页失败'))
      const info = (await res.json()) as Inspected
      if (info.images.length === 0) throw new Error('这个页面里没有找到图片')

      const files: File[] = []
      let dropped = 0

      for (let i = 0; i < info.images.length; i++) {
        setBusy(`正在下载图片 ${i + 1}/${info.images.length}…`)
        try {
          const img = await fetch(`/api/import/fetch?url=${encodeURIComponent(info.images[i])}`)
          // Non-images (tracking beacons, analytics endpoints) are rejected by
          // the proxy — skip them quietly rather than failing the whole import.
          if (!img.ok) {
            dropped++
            continue
          }
          const blob = await img.blob()
          if (!(await isRealPage(blob))) {
            dropped++
            continue
          }
          const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
          files.push(
            new File([blob], `${String(i + 1).padStart(3, '0')}.${ext}`, { type: blob.type }),
          )
        } catch {
          dropped++
        }
      }

      if (files.length === 0) throw new Error('没有下载到可用的图片')
      setSkipped(dropped)
      setBusy('正在处理…')
      await onImported(files, info)
      setUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel">
      <h2>从网页导入</h2>
      {error ? <div className="alert error">{error}</div> : null}
      <div className="import-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴网页地址，例如小米/华为的在线说明书"
          disabled={!!busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(e)
          }}
        />
        <button className="btn" type="button" onClick={run} disabled={!!busy || !url.trim()}>
          {busy ? '处理中…' : '导入'}
        </button>
      </div>
      <p className="hint">
        {busy ??
          '会把页面里的图片按顺序抓下来，标题也一并带过来。图片仍在你的浏览器里压缩后才上传。'}
      </p>
      {skipped > 0 ? (
        <p className="hint">已跳过 {skipped} 个非正文内容（埋点像素、图标等）。</p>
      ) : null}
    </div>
  )
}
