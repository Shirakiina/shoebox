'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_OPTIONS, formatBytes, type CompressOptions } from '@/lib/compress'
import {
  prepareFiles,
  toPagePayload,
  uploadAll,
  withAttachments,
  type PreparedFile,
} from '@/lib/upload-client'
import MetaFields, { EMPTY_META, type ManualMeta } from './MetaFields'
import CompressOptionsPanel from './CompressOptionsPanel'
import PageGrid from './PageGrid'
import { usePreviewUrls } from './usePreviewUrls'
import WebImport, { type Inspected } from './WebImport'
import { pageBadge, pageKind } from '@/lib/mime'
import { errorMessage } from '@/lib/http'

type Props = { driver: string; canPresign: boolean; suggestions: string[]; categories: string[] }

export default function UploadForm({ driver, canPresign, suggestions, categories }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [opts, setOpts] = useState<CompressOptions>(DEFAULT_OPTIONS)
  const [items, setItems] = useState<PreparedFile[]>([])
  const [meta, setMeta] = useState<ManualMeta>(EMPTY_META)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notes, setNotes] = useState<string[]>([])

  const previews = usePreviewUrls(items)

  const totals = useMemo(() => {
    const all = withAttachments(items)
    const before = all.reduce((n, i) => n + i.originalSize, 0)
    const after = all.reduce((n, i) => n + i.processed.blob.size, 0)
    return { before, after }
  }, [items])

  const gridItems = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        url: previews.get(item.id) ?? null,
        sub: item.attachments?.length
          ? `${formatBytes(item.processed.blob.size)} · ${item.attachments.length} 张图`
          : pageKind(item.processed.mime) === 'file'
            ? `${item.name} · ${formatBytes(item.originalSize)}`
            : `${formatBytes(item.originalSize)} → ${formatBytes(item.processed.blob.size)}`,
        tag: item.duplicate ? '秒传' : item.processed.trimmed ? '已裁边' : undefined,
        placeholder: pageBadge(item.processed.mime, item.name),
      })),
    [items, previews],
  )

  function reorder(ids: string[]) {
    const byId = new Map(items.map((i) => [i.id, i]))
    setItems(ids.map((id) => byId.get(id)!).filter(Boolean))
  }

  const addFiles = useCallback(
    async (fileList: FileList | File[], defaultTitle?: string) => {
      const files = Array.from(fileList)
      if (files.length === 0) return

      setError(null)
      setNotes([])
      setBusy('正在压缩…')
      setProgress(0)

      const { prepared, problems, notes: pdfNotes, titles } = await prepareFiles(
        files,
        opts,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        (label) => setBusy(label),
      )

      setItems((prev) => [...prev, ...prepared])
      setNotes(pdfNotes)
      if (problems.length) setError(problems.join('；'))

      const fallback = defaultTitle || titles[0] || files[0]?.name.replace(/\.[^.]+$/, '')
      if (fallback) setMeta((m) => (m.title ? m : { ...m, title: fallback }))

      setBusy(null)
      setProgress(0)
    },
    [opts],
  )

  const onImported = useCallback(
    async (files: File[], info: Inspected) => {
      await addFiles(files, info.title)
      if (info.sourceUrl) {
        setMeta((m) => (m.notes ? m : { ...m, notes: `来源：${info.sourceUrl}` }))
      }
    },
    [addFiles],
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!meta.title.trim()) return setError('请填写标题')
    if (items.length === 0) return setError('请先选择文件')

    setError(null)
    setBusy('正在上传…')
    setProgress(0)

    try {
      await uploadAll(items, canPresign, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      )

      setBusy('正在保存…')
      const res = await fetch('/api/manuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta, pages: items.map(toPagePayload) }),
      })
      if (!res.ok) throw new Error(await errorMessage(res, '保存失败'))
      const { id } = (await res.json()) as { id: string }
      router.push(`/m/${id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
      setProgress(0)
    }
  }

  return (
    <form onSubmit={submit}>
      {error ? <div className="alert error">{error}</div> : null}
      {notes.length > 0 ? (
        <div className="alert info">
          {notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      ) : null}

      <WebImport onImported={onImported} />

      <CompressOptionsPanel value={opts} onChange={setOpts} />

      <div
        className={`dropzone${dragging ? ' over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void addFiles(e.dataTransfer.files)
        }}
      >
        <strong>把文件拖到这里，或点击选择</strong>
        图片会压缩，PDF 能变小就拆页，Markdown 排版显示；其他文件（Word、Excel、压缩包…）原样保存、可下载。
        多选按文件名自然排序；Markdown 引用的图片一起拖进来即可
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {items.length > 0 ? (
        <>
          <PageGrid
            items={gridItems}
            onReorder={reorder}
            onRemove={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
          />
          <p className="sub" style={{ marginTop: 10 }}>
            共 {items.length} 页：{formatBytes(totals.before)} → <b>{formatBytes(totals.after)}</b>
            {totals.before > 0
              ? `（省 ${Math.round((1 - totals.after / totals.before) * 100)}%）`
              : ''}
          </p>
        </>
      ) : null}

      <div className="panel" style={{ marginTop: 20 }}>
        <h2>信息</h2>
        <MetaFields value={meta} onChange={setMeta} suggestions={suggestions} categories={categories} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="btn btn-primary" type="submit" disabled={!!busy || items.length === 0}>
          {busy ?? '保存到库'}
        </button>
        <span className="sub" style={{ margin: 0 }}>
          存储：{driver === 'r2' ? 'Cloudflare R2（浏览器直传）' : '本机磁盘'}
        </span>
      </div>

      {busy ? (
        <div className="progress">
          <div style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </form>
  )
}
