import Link from 'next/link'
import { allCategories, allKeywords, listManuals, stats } from '@/lib/db'
import { parseKeywords } from '@/lib/keywords'
import { urlsFor } from '@/lib/storage'
import { isImageMime, pageBadge } from '@/lib/mime'

export const dynamic = 'force-dynamic'

const MAX_CHIPS = 14

/** Keeps the search and the category filter when changing either one. */
function hrefFor(q: string, c: string): string {
  const params = new URLSearchParams()
  if (c) params.set('c', c)
  if (q) params.set('q', q)
  const s = params.toString()
  return s ? `/?${s}` : '/'
}

function mb(n: number) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; c?: string }>
}) {
  const { q, c } = await searchParams
  const query = q?.trim() ?? ''
  const category = c?.trim() ?? ''
  const manuals = listManuals(query, category)
  const categories = allCategories()
  const urls = await urlsFor(manuals.map((m) => m.cover_key).filter((k): k is string => !!k))
  const keywords = allKeywords().slice(0, MAX_CHIPS)
  const s = stats()

  return (
    <>
      <h1>我的资料</h1>
      <p className="sub">
        {[category, query && `“${query}”`].filter(Boolean).join(' · ') || '全部'} · {manuals.length} 份
      </p>

      {categories.length > 0 ? (
        <nav className="category-tabs" aria-label="按分类筛选">
          <Link href={hrefFor(query, '')} className={category ? '' : 'active'}>
            全部
          </Link>
          {categories.map(({ name, count }) => (
            <Link key={name} href={hrefFor(query, name)} className={category === name ? 'active' : ''}>
              {name}
              <span className="chip-count">{count}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <form className="toolbar" action="/">
        {category ? <input type="hidden" name="c" value={category} /> : null}
        <input
          type="search"
          name="q"
          placeholder="搜标题、分类、关键词、备注、文件名…"
          defaultValue={query}
        />
        <button className="btn" type="submit">
          搜索
        </button>
        {query ? (
          <Link className="btn" href={hrefFor('', category)}>
            清空
          </Link>
        ) : null}
      </form>

      {keywords.length > 0 ? (
        <div className="keyword-bar">
          {keywords.map(({ word, count }) => (
            <Link
              key={word}
              href={hrefFor(word, category)}
              className={`chip chip-link${query === word ? ' active' : ''}`}
            >
              {word}
              <span className="chip-count">{count}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {manuals.length === 0 ? (
        <div className="empty">
          {query || category ? (
            <>
              没有匹配的资料。
              <br />
              <span className="sub">多个词之间用空格分隔，需要全部命中。</span>
            </>
          ) : (
            <>
              还是空的。<Link href="/upload">添加第一份资料 →</Link>
            </>
          )}
        </div>
      ) : (
        <div className="cards">
          {manuals.map((m) => {
            const cover = m.cover_key ? urls.get(m.cover_key) : null
            const words = parseKeywords(m.keywords)
            return (
              <Link key={m.id} href={`/m/${m.id}`} className="card">
                <div className={`thumb${m.cover_wide ? ' wide' : ''}`}>
                  {cover && m.cover_mime && isImageMime(m.cover_mime) ? (
                    <img src={cover} alt="" loading="lazy" />
                  ) : (
                    <span className="pdf-badge">{pageBadge(m.cover_mime ?? '', m.cover_name) ?? '—'}</span>
                  )}
                </div>
                <div className="meta">
                  <strong>{m.title}</strong>
                  <small>
                    {m.category || '未分类'} · {m.page_count} 页
                  </small>
                  {words.length > 0 ? (
                    <div className="card-tags">
                      {words.slice(0, 3).map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                      {words.length > 3 ? <span>+{words.length - 3}</span> : null}
                    </div>
                  ) : null}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <div className="stats">
        <span>
          <b>{s.manuals}</b> 份资料
        </span>
        <span>
          <b>{s.files}</b> 个文件 / {s.pageRefs} 页引用
        </span>
        <span>
          占用 <b>{mb(s.bytes)}</b>
          {s.original_bytes > s.bytes ? (
            <> ，压缩前 {mb(s.original_bytes)}（省 {Math.round((1 - s.bytes / s.original_bytes) * 100)}%）</>
          ) : null}
        </span>
        {s.dedupeSaved > 0 ? (
          <span>
            去重命中 <b>{s.dedupeSaved}</b> 次
          </span>
        ) : null}
      </div>
    </>
  )
}
