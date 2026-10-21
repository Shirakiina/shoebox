'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_OPTIONS, formatBytes, type CompressOptions } from '@/lib/compress'
import { prepareFiles, toPagePayload, uploadAll, type PreparedFile } from '@/lib/upload-client'
import CompressOptionsPanel from './CompressOptionsPanel'
import PageGrid from './PageGrid'
import { usePreviewUrls } from './usePreviewUrls'
import WebImport from './WebImport'
import { isImageMime, pageBadge, pageKind } from '@/lib/mime'
import { errorMessage } from '@/lib/http'

export type ExistingPage = {
  hash: string
  key: string
  mime: string
  size: number
  width: number | null
  height: number | null
  name: string | null
  url: string
}

/** A row in the editor: either a page already stored, or one just prepared. */
type Row =
  | { kind: 'existing'; id: string; page: ExistingPage }
  /** trimmedFrom: hash of the stored page this one replaces after a margin trim. */
  | { kind: 'new'; id: string; file: PreparedFile; trimmedFrom?: string }

export default function PageEditor({
  manualId,
  pages,
  canPresign,
  onClose,
}: {
  manualId: string
  pages: ExistingPage[]
  canPresign: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<Row[]>(() =>
    pages.map((page, i) => ({ kind: 'existing', id: `p${i}-${page.hash}`, page })),
  )
  const [opts, setOpts] = useState<CompressOptions>(DEFAULT_OPTIONS)
  const [showOpts, setShowOpts] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notes, setNotes] = useState<string[]>([])

  const added = useMemo(
    () => rows.flatMap((r) => (r.kind === 'new' ? [r.file] : [])),
    [rows],
  )
  const previews = usePreviewUrls(added)

  const original = useMemo(() => pages.map((p) => p.hash).join('|'), [pages])
  const current = rows
    .map((r) => (r.kind === 'existing' ? r.page.hash : r.file.hash))
    .join('|')
  const dirty = current !== original

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      if (files.length === 0) return

      setError(null)
      setBusy('正在压缩…')
      setProgress(0)

      const { prepared, problems, notes: pdfNotes } = await prepareFiles(
        files,
        opts,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        (label) => setBusy(label),
      )
      setNotes(pdfNotes)
      setRows((prev) => [
        ...prev,
        ...prepared.map((file) => ({ kind: 'new' as const, id: file.id, file })),
      ])
      if (problems.length) setError(problems.join('；'))

      setBusy(null)
      setProgress(0)
    },
    [opts],
  )

  const gridItems = useMemo(
    () =>
      rows.map((row) =>
        row.kind === 'existing'
          ? {
              id: row.id,
              url: isImageMime(row.page.mime) ? row.page.url : null,
              sub:
                pageKind(row.page.mime) === 'file'
                  ? `${row.page.name ?? '文件'} · ${formatBytes(row.page.size)}`
                  : formatBytes(row.page.size),
              placeholder: pageBadge(row.page.mime, row.page.name),
            }
          : {
              id: row.id,
              url: previews.get(row.id) ?? null,
              sub: row.file.attachments?.length
                ? `${formatBytes(row.file.processed.blob.size)} · ${row.file.attachments.length} 张图`
                : pageKind(row.file.processed.mime) === 'file'
                  ? `${row.file.name} · ${formatBytes(row.file.originalSize)}`
                  : `${formatBytes(row.file.originalSize)} → ${formatBytes(row.file.processed.blob.size)}`,
              tag: row.trimmedFrom ? '已裁边' : row.file.duplicate ? '秒传' : '新增',
              placeholder: pageBadge(row.file.processed.mime, row.file.name),
            },
      ),
    [rows, previews],
  )

  function reorder(ids: string[]) {
    const byId = new Map(rows.map((r) => [r.id, r]))
    setRows(ids.map((id) => byId.get(id)!).filter(Boolean))
  }

  const removedCount =
    pages.length - rows.filter((r) => r.kind === 'existing').length -
    rows.filter((r) => r.kind === 'new' && r.trimmedFrom).length
  const trimmedCount = rows.filter((r) => r.kind === 'new' && r.trimmedFrom).length
  const trimmable = rows.filter(
    (r) => r.kind === 'existing' && isImageMime(r.page.mime),
  ).length

  /**
   * Re-runs stored pages through the pipeline with trimming on. Only pages that
   * actually had margins are swapped out; the rest stay as they are, so nothing
   * takes a needless second lossy encode.
   */
  async function trimExisting() {
    const targets = rows.filter(
      (r): r is Extract<Row, { kind: 'existing' }> =>
        r.kind === 'existing' && isImageMime(r.page.mime),
    )
    if (targets.length === 0) return

    setError(null)
    setNotes([])
    setBusy('正在检测白边…')
    setProgress(0)

    // This is a second lossy pass, but at the same quality it is not visible:
    // measured ~39 dB against the stored page with small print indistinguishable
    // at 2x zoom, whereas bumping to 0.85 cost 30–40% more bytes for ~3 dB.
    const trimOpts: CompressOptions = { ...opts, trim: true }
    const replaced = new Map<string, Row>()
    const failed: string[] = []

    for (let i = 0; i < targets.length; i++) {
      const row = targets[i]
      try {
        const res = await fetch(row.page.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        // Keep the stored name: the trimmed page replaces this one in place.
        const file = new File([blob], row.page.name ?? `page-${String(i).padStart(4, '0')}`, {
          type: row.page.mime,
        })
        const { prepared, problems } = await prepareFiles([file], trimOpts)
        if (problems.length) throw new Error(problems[0])
        const next = prepared[0]
        if (next?.processed.trimmed) {
          replaced.set(row.id, { kind: 'new', id: next.id, file: next, trimmedFrom: row.page.hash })
        }
      } catch (err) {
        failed.push(`第 ${rows.indexOf(row) + 1} 页：${err instanceof Error ? err.message : String(err)}`)
      }
      setProgress(Math.round(((i + 1) / targets.length) * 100))
    }

    setRows((prev) => prev.map((r) => replaced.get(r.id) ?? r))
    const untouched = targets.length - replaced.size - failed.length
    setNotes([
      replaced.size > 0
        ? `${replaced.size} 页裁掉了白边${untouched > 0 ? `，${untouched} 页没有明显白边、保持原样` : ''}。点「保存」生效。`
        : '没有检测到明显的白边。',
    ])
    if (failed.length) setError(failed.join('；'))
    setBusy(null)
    setProgress(0)
  }

  async function save() {
    if (rows.length === 0) return setError('至少要保留一页。想整份删掉请用「删除」。')

    setError(null)
    setBusy('正在上传新页面…')
    setProgress(0)

    try {
      await uploadAll(added, canPresign, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      )

      setBusy('正在保存…')
      const res = await fetch(`/api/manuals/${manualId}/pages`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: rows.map((row) =>
            row.kind === 'existing'
              ? {
                  hash: row.page.hash,
                  key: '',
                  mime: row.page.mime,
                  size: row.page.size,
                  width: row.page.width,
                  height: row.page.height,
                  name: row.page.name,
                }
              : toPagePayload(row.file),
          ),
        }),
      })
      if (!res.ok) throw new Error(await errorMessage(res, '保存失败'))

      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
      setProgress(0)
    }
  }

  return (
    <div className="panel edit-panel">
      <h2>管理页面</h2>
      {error ? <div className="alert error">{error}</div> : null}
      {notes.length > 0 ? (
        <div className="alert info">
          {notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      ) : null}

      <div className="page-editor-bar">
        <p className="hint" style={{ margin: 0 }}>
          拖动缩略图可以调整顺序，也可以用 ← → 按钮。改动在点「保存」之前不会生效。
        </p>
        {trimmable > 0 ? (
          <button className="btn btn-sm" type="button" onClick={trimExisting} disabled={!!busy}>
            裁掉白边
          </button>
        ) : null}
      </div>

      <PageGrid
        items={gridItems}
        onReorder={reorder}
        onRemove={(id) => setRows((prev) => prev.filter((r) => r.id !== id))}
      />

      <div
        className={`dropzone${dragging ? ' over' : ''}`}
        style={{ marginTop: 16, padding: '22px 20px' }}
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
        <strong>添加页面或文件</strong>
        拖进来或点击选择，会追加到末尾；图片以外的文件原样保存
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

      <details className="more" open={showOpts} onToggle={(e) => setShowOpts(e.currentTarget.open)}>
        <summary>更多来源与压缩设置</summary>
        <div style={{ marginTop: 14 }}>
          <WebImport onImported={(files) => addFiles(files)} />
          <CompressOptionsPanel value={opts} onChange={setOpts} />
        </div>
      </details>

      <div className="edit-actions">
        <button className="btn btn-primary" type="button" onClick={save} disabled={!!busy || !dirty}>
          {busy ?? '保存'}
        </button>
        <button className="btn" type="button" onClick={onClose} disabled={!!busy}>
          取消
        </button>
        <span className="hint" style={{ margin: 0 }}>
          {dirty
            ? `${rows.length} 页${removedCount > 0 ? `，移除 ${removedCount} 页` : ''}${
                trimmedCount > 0 ? `，裁边 ${trimmedCount} 页` : ''
              }${added.length - trimmedCount > 0 ? `，新增 ${added.length - trimmedCount} 页` : ''}`
            : '还没有改动'}
        </span>
      </div>

      {busy ? (
        <div className="progress">
          <div style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  )
}
