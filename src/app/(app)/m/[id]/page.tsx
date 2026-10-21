import { notFound } from 'next/navigation'
import {
  allCategories,
  allKeywords,
  getAttachments,
  getManual,
  getPages,
  type AttachmentRow,
  type PageRow,
} from '@/lib/db'
import { getStorage, urlsFor } from '@/lib/storage'
import { MARKDOWN_MIME } from '@/lib/mime'
import { renderMarkdown } from '@/lib/markdown'
import Viewer from '@/components/Viewer'
import ManualEditor from '@/components/ManualEditor'

export const dynamic = 'force-dynamic'

export default async function ManualPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ p?: string }>
}) {
  const { id } = await params
  const { p } = await searchParams
  const manual = getManual(id)
  if (!manual) notFound()

  const pages = getPages(id)
  const urls = await urlsFor(pages.map((page) => page.key))
  const storage = getStorage()
  const downloads = await Promise.all(
    pages.map((page) => storage.downloadUrl(page.key, page.name ?? page.key.split('/').pop()!)),
  )
  const attachments = getAttachments(pages.filter((p) => p.mime === MARKDOWN_MIME).map((p) => p.hash))
  // A markdown page's images are part of what the manual weighs.
  const bytes =
    pages.reduce((n, page) => n + page.size, 0) +
    [...attachments.values()].flat().reduce((n, a) => n + a.size, 0)

  const html = await renderMarkdownPages(pages, attachments)

  const withUrls = pages.map((page, i) => ({
    hash: page.hash,
    key: page.key,
    mime: page.mime,
    size: page.size,
    width: page.width,
    height: page.height,
    name: page.name,
    url: urls.get(page.key)!,
    downloadUrl: downloads[i],
    html: html.get(page.hash),
  }))

  // ?p= is 1-based in the URL, 0-based internally.
  const requested = Number(p)
  const initialPage =
    Number.isInteger(requested) && requested >= 1 && requested <= pages.length ? requested - 1 : 0

  return (
    <ManualEditor
      id={manual.id}
      meta={{
        title: manual.title,
        category: manual.category ?? '',
        keywords: manual.keywords ?? '',
        notes: manual.notes ?? '',
      }}
      suggestions={allKeywords().map((k) => k.word)}
      categories={allCategories().map((c) => c.name)}
      pages={withUrls.map(({ html: _html, ...page }) => page)}
      canPresign={storage.supportsPresign}
      createdLabel={new Date(manual.created_at).toLocaleDateString('zh-CN')}
      pageCount={pages.length}
      sizeLabel={`${(bytes / 1024 / 1024).toFixed(2)} MB`}
    >
      <Viewer initialPage={initialPage} pages={withUrls} />
    </ManualEditor>
  )
}

/**
 * Renders each markdown page to sanitised HTML, with its embedded images
 * pointed at wherever storage serves them from right now (a signed R2 URL
 * expires, so this can't be baked in at upload).
 */
async function renderMarkdownPages(
  pages: PageRow[],
  attachments: Map<string, AttachmentRow[]>,
): Promise<Map<string, string>> {
  const markdown = pages.filter((p) => p.mime === MARKDOWN_MIME)
  const out = new Map<string, string>()
  if (markdown.length === 0) return out

  const imageUrls = await urlsFor([...attachments.values()].flat().map((a) => a.key))
  const storage = getStorage()

  await Promise.all(
    markdown.map(async (page) => {
      const bySrc = new Map((attachments.get(page.hash) ?? []).map((a) => [a.src, imageUrls.get(a.key)]))
      let source: string
      try {
        source = (await storage.get(page.key)).toString('utf8')
      } catch {
        out.set(page.hash, '<p class="md-missing-image">［这一页的 markdown 文件读取失败］</p>')
        return
      }
      out.set(page.hash, renderMarkdown(source, (src) => bySrc.get(src)))
    }),
  )
  return out
}
