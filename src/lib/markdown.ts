import sanitizeHtml from 'sanitize-html'
import { createMarkdown } from './markdown-refs'

/**
 * Server-side markdown rendering. The output goes into the page as raw HTML,
 * so everything passes a whitelist sanitiser: raw HTML in the document is
 * allowed (READMEs lean on <img width>, <br>, <details>), scripts, event
 * handlers, style and iframes are not.
 *
 * Images only ever load from the manual's own stored attachments. Anything
 * else — an address that was not resolved at upload, a remote URL — becomes
 * its alt text. A manual therefore never pulls from the network when opened:
 * no tracking pixels, and nothing breaks later when a remote host goes away.
 */

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'blockquote', 'div', 'span',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'del', 's', 'u', 'mark', 'sup', 'sub', 'kbd', 'small',
  'code', 'pre',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'details', 'summary',
]

/** @returns sanitised HTML */
export function renderMarkdown(
  source: string,
  /** Stored image for an address written in the document, if one was uploaded. */
  resolveImage: (src: string) => string | undefined,
): string {
  const html = createMarkdown().render(source)

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      th: ['align', 'colspan', 'rowspan'],
      td: ['align', 'colspan', 'rowspan'],
      p: ['align'],
      div: ['align'],
      h1: ['align'],
      h2: ['align'],
      h3: ['align'],
      ol: ['start'],
      code: ['class'],
      details: ['open'],
      span: ['class'],
    },
    allowedClasses: {
      code: [/^language-[\w-]+$/],
      span: ['md-missing-image'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attribs): sanitizeHtml.Tag => {
        const url = resolveImage(attribs.src ?? '')
        if (!url) {
          return {
            tagName: 'span',
            attribs: { class: 'md-missing-image' },
            text: attribs.alt ? `［图片：${attribs.alt}］` : '［图片缺失］',
          }
        }
        return { tagName: 'img', attribs: { ...attribs, src: url, loading: 'lazy' } }
      },
      a: (tag, attribs): sanitizeHtml.Tag =>
        /^https?:/i.test(attribs.href ?? '')
          ? { tagName: tag, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }
          : { tagName: tag, attribs },
    },
  })
}
