'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { extLabel, pageBadge, pageKind } from '@/lib/mime'
import { formatBytes } from '@/lib/compress'

export type ViewerPage = {
  url: string
  /** Same blob, served as a download under its original name. */
  downloadUrl: string
  mime: string
  size: number
  width: number | null
  height: number | null
  name: string | null
  /** Sanitised HTML for a markdown page, rendered on the server. */
  html?: string
}

const LINK_LABEL = { image: '原图', pdf: '原文件', markdown: '源文件', file: '下载' } as const

export default function Viewer({
  pages,
  initialPage = 0,
}: {
  pages: ViewerPage[]
  /** 0-based page to open at, e.g. from a search hit. */
  initialPage?: number
}) {
  const [active, setActive] = useState(initialPage)
  const [flash, setFlash] = useState(initialPage > 0 ? initialPage : -1)
  const sheetRefs = useRef<(HTMLDivElement | null)[]>([])

  const scrollToPage = useCallback((i: number, behavior: ScrollBehavior = 'smooth') => {
    const el = sheetRefs.current[i]
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 68 // clear the sticky header
    window.scrollTo({ top, behavior })
  }, [])

  // Jump to the page a search result pointed at, and flag it briefly.
  useEffect(() => {
    if (initialPage <= 0 || initialPage >= pages.length) return
    const jump = requestAnimationFrame(() => scrollToPage(initialPage, 'auto'))
    const clear = setTimeout(() => setFlash(-1), 2200)
    return () => {
      cancelAnimationFrame(jump)
      clearTimeout(clear)
    }
  }, [initialPage, pages.length, scrollToPage])

  // Track which sheet occupies the middle of the viewport.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(Number((visible.target as HTMLElement).dataset.page))
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.01, 0.5, 1] },
    )
    for (const el of sheetRefs.current) if (el) observer.observe(el)

    // A short last page (a file card, a business card) never reaches the
    // middle of the viewport; at the bottom of the document, it is current.
    function onScroll() {
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        setActive(pages.length - 1)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [pages.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        scrollToPage(Math.min(pages.length - 1, active + 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        scrollToPage(Math.max(0, active - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, pages.length, scrollToPage])

  if (pages.length === 0) return <div className="empty">这份资料还没有内容。</div>

  return (
    <div className="reader">
      {pages.length > 1 ? (
        <aside className="rail">
          {pages.map((p, i) => (
            <button
              key={i}
              type="button"
              className={i === active ? 'active' : ''}
              onClick={() => scrollToPage(i)}
              aria-label={`跳到第 ${i + 1} 页`}
            >
              {pageKind(p.mime) === 'image' ? (
                <img src={p.url} alt="" loading="lazy" />
              ) : (
                <span className="pdf-mini">{pageBadge(p.mime, p.name)}</span>
              )}
              <span className="num">{i + 1}</span>
            </button>
          ))}
        </aside>
      ) : (
        <div />
      )}

      {/* One continuous document: sheets butt together with no seam. */}
      <div className="doc">
        {pages.map((p, i) => (
          <div
            key={i}
            className={`sheet${i === flash ? ' flash' : ''}`}
            data-page={i}
            ref={(el) => {
              sheetRefs.current[i] = el
            }}
          >
            {pageKind(p.mime) === 'file' ? (
              <FileCard page={p} />
            ) : pageKind(p.mime) === 'pdf' ? (
              <iframe src={p.url} title={`第 ${i + 1} 页`} />
            ) : pageKind(p.mime) === 'markdown' ? (
              // Sanitised on the server by src/lib/markdown.ts — scripts,
              // handlers, styles and non-attachment images are already gone.
              <article className="md" dangerouslySetInnerHTML={{ __html: p.html ?? '' }} />
            ) : (
              <img
                src={p.url}
                alt={`第 ${i + 1} 页`}
                loading={i < 2 ? 'eager' : 'lazy'}
                /* Attributes only hint the intrinsic ratio — CSS does the sizing. */
                width={p.width ?? undefined}
                height={p.height ?? undefined}
              />
            )}
          </div>
        ))}
      </div>

      {pages.length > 1 ? (
        <div className="page-pill">
          <button onClick={() => scrollToPage(Math.max(0, active - 1))} disabled={active === 0}>
            ←
          </button>
          <span>
            {active + 1} / {pages.length}
          </span>
          <button
            onClick={() => scrollToPage(Math.min(pages.length - 1, active + 1))}
            disabled={active === pages.length - 1}
          >
            →
          </button>
          {pageKind(pages[active].mime) === 'file' ? (
            <a href={pages[active].downloadUrl} title="下载当前文件">
              下载
            </a>
          ) : (
            <a href={pages[active].url} target="_blank" rel="noreferrer" title="打开当前页原文件">
              {LINK_LABEL[pageKind(pages[active].mime)]}
            </a>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A file the browser can't show — Word, Excel, a zip, a HEIC. It is never
 * rendered inline (see src/app/api/files), only offered as a download.
 */
function FileCard({ page }: { page: ViewerPage }) {
  return (
    <div className="file-card">
      <span className="file-ext">{extLabel(page.name)}</span>
      <div className="file-info">
        <strong>{page.name ?? '未命名文件'}</strong>
        <small>{formatBytes(page.size)} · 浏览器里无法预览，下载后用对应软件打开</small>
      </div>
      <a className="btn btn-primary" href={page.downloadUrl}>
        下载
      </a>
    </div>
  )
}
