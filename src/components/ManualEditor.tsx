'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { parseKeywords } from '@/lib/keywords'
import MetaFields, { type ManualMeta } from './MetaFields'
import DeleteButton from './DeleteButton'
import PageEditor, { type ExistingPage } from './PageEditor'
import { errorMessage } from '@/lib/http'

type Props = {
  id: string
  meta: ManualMeta
  suggestions: string[]
  categories: string[]
  pages: ExistingPage[]
  canPresign: boolean
  /** Formatted on the server — a client-side toLocaleDateString would risk a
   *  hydration mismatch when the two locales disagree. */
  createdLabel: string
  pageCount: number
  sizeLabel: string
  /** The viewer, hidden while the page list is being edited. */
  children: React.ReactNode
}

export default function ManualEditor({
  id,
  meta,
  suggestions,
  categories,
  pages,
  canPresign,
  createdLabel,
  pageCount,
  sizeLabel,
  children,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [editingPages, setEditingPages] = useState(false)
  const [draft, setDraft] = useState<ManualMeta>(meta)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setDraft(meta) // always reopen from what is actually stored
    setError(null)
    setEditing(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) return setError('标题不能为空')

    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/manuals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) throw new Error(await errorMessage(res, '保存失败'))
      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (editingPages) {
    return (
      <PageEditor
        manualId={id}
        pages={pages}
        canPresign={canPresign}
        onClose={() => setEditingPages(false)}
      />
    )
  }

  if (editing) {
    return (
      <>
      <form className="panel edit-panel" onSubmit={save}>
        <h2>编辑信息</h2>
        {error ? <div className="alert error">{error}</div> : null}
        <MetaFields
          value={draft}
          onChange={setDraft}
          suggestions={suggestions}
          categories={categories}
          idPrefix="edit-"
        />
        <div className="edit-actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
          >
            取消
          </button>
          <span className="hint" style={{ margin: 0 }}>
            只改信息，不影响已上传的 {pageCount} 页
          </span>
        </div>
      </form>
      {children}
      </>
    )
  }

  const keywords = parseKeywords(meta.keywords)

  return (
    <>
      <div className="detail-head">
        <div>
          <h1>{meta.title}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {pageCount} 页 · {sizeLabel} · {createdLabel}
          </p>
          <div className="chips">
            {meta.category ? (
              <Link href={`/?c=${encodeURIComponent(meta.category)}`} className="chip chip-link chip-category">
                {meta.category}
              </Link>
            ) : null}
            {keywords.map((word) => (
              <Link key={word} href={`/?q=${encodeURIComponent(word)}`} className="chip chip-link">
                {word}
              </Link>
            ))}
          </div>
        </div>
        <div className="spacer" />
        <Link href="/" className="btn btn-sm">
          ← 返回
        </Link>
        <button className="btn btn-sm" type="button" onClick={startEditing}>
          编辑信息
        </button>
        <button className="btn btn-sm" type="button" onClick={() => setEditingPages(true)}>
          管理页面
        </button>
        <DeleteButton id={id} title={meta.title} />
      </div>

      {meta.notes ? (
        <div className="alert info" style={{ whiteSpace: 'pre-wrap' }}>
          {meta.notes}
        </div>
      ) : null}

      {children}
    </>
  )
}
