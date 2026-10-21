'use client'

import { useState } from 'react'

export type GridItem = {
  id: string
  /** Preview URL; null renders a PDF placeholder. */
  url: string | null
  /** Small line under the thumbnail, e.g. sizes. */
  sub?: string
  /** Corner pill, e.g. "新增" or "秒传". */
  tag?: string
  /** Shown instead of a thumbnail when there is no preview (e.g. a PDF). */
  placeholder?: string
}

/**
 * Ordered thumbnails with drag-to-reorder and per-item removal. Used both for
 * the upload queue and for editing an existing manual's pages, so page order
 * behaves the same before and after a manual exists.
 */
export default function PageGrid({
  items,
  onReorder,
  onRemove,
}: {
  items: GridItem[]
  onReorder: (ids: string[]) => void
  onRemove: (id: string) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  function move(fromId: string, toId: string) {
    if (fromId === toId) return
    const ids = items.map((i) => i.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(ids)
  }

  /** Keyboard equivalent of dragging, so reordering works without a mouse. */
  function nudge(id: string, delta: number) {
    const ids = items.map((i) => i.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    onReorder(ids)
  }

  return (
    <ol className="page-grid">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={`page-cell${dragId === item.id ? ' dragging' : ''}${
            overId === item.id && dragId !== item.id ? ' over' : ''
          }`}
          draggable
          onDragStart={(e) => {
            setDragId(item.id)
            e.dataTransfer.effectAllowed = 'move'
            // Firefox needs data set for a drag to start at all.
            e.dataTransfer.setData('text/plain', item.id)
          }}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setOverId(item.id)
          }}
          onDragLeave={() => setOverId((cur) => (cur === item.id ? null : cur))}
          onDrop={(e) => {
            e.preventDefault()
            const from = dragId ?? e.dataTransfer.getData('text/plain')
            if (from) move(from, item.id)
            setDragId(null)
            setOverId(null)
          }}
        >
          <div className="page-thumb">
            {item.url ? (
              <img src={item.url} alt="" loading="lazy" />
            ) : (
              <span>{item.placeholder ?? '…'}</span>
            )}
            <span className="page-num">{index + 1}</span>
            {item.tag ? <span className="page-tag">{item.tag}</span> : null}
          </div>

          <div className="page-cell-foot">
            <button
              type="button"
              className="icon-btn"
              title="上移"
              aria-label={`把第 ${index + 1} 页上移`}
              disabled={index === 0}
              onClick={() => nudge(item.id, -1)}
            >
              ←
            </button>
            <button
              type="button"
              className="icon-btn"
              title="下移"
              aria-label={`把第 ${index + 1} 页下移`}
              disabled={index === items.length - 1}
              onClick={() => nudge(item.id, 1)}
            >
              →
            </button>
            <button
              type="button"
              className="icon-btn danger"
              title="移除"
              aria-label={`移除第 ${index + 1} 页`}
              onClick={() => onRemove(item.id)}
            >
              ×
            </button>
          </div>

          {item.sub ? <p className="page-sub">{item.sub}</p> : null}
        </li>
      ))}
    </ol>
  )
}
