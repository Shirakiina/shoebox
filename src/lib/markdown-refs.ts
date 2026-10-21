import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'

/**
 * Markdown pieces shared by the browser (finding which images a document
 * refers to, at upload time) and the server (rendering). Both sides must parse
 * with the same configuration: markdown-it normalises image addresses —
 * percent-encoding spaces and CJK, for instance — and the address recorded at
 * upload has to match the one the renderer sees, byte for byte.
 */

export function createMarkdown() {
  // CommonMark line breaks, as GitHub renders a README — manuals exported
  // from a repo should look the way their authors saw them.
  return new MarkdownIt({ html: true, linkify: true, typographer: false })
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'" }

/** Enough entity decoding to match how the HTML sanitiser reads an attribute. */
function decodeEntities(value: string): string {
  return value.replace(/&(amp|quot|apos|lt|gt|#39);/g, (_, name: string) => ENTITIES[name])
}

/** src values of <img> tags inside a raw HTML fragment. */
export function htmlImageSrcs(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map((m) => decodeEntities(m[1] ?? m[2] ?? m[3] ?? ''))
    .filter(Boolean)
}

function walk(tokens: Token[], visit: (t: Token) => void) {
  for (const t of tokens) {
    visit(t)
    if (t.children) walk(t.children, visit)
  }
}

/**
 * Every image address the document refers to, as the renderer will see it.
 * Parsing rather than pattern-matching means an image written inside a code
 * block — an example, not a picture — is correctly left out.
 */
export function findImageRefs(source: string): string[] {
  const found = new Set<string>()
  walk(createMarkdown().parse(source, {}), (t) => {
    if (t.type === 'image') {
      const src = t.attrGet('src')
      if (src) found.add(String(src))
    } else if (t.type === 'html_block' || t.type === 'html_inline') {
      for (const src of htmlImageSrcs(t.content)) found.add(src)
    }
  })
  return [...found]
}

/** Text of the first heading, used as a default title. */
export function firstHeading(source: string): string | null {
  const tokens = createMarkdown().parse(source, {})
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'heading_open') {
      const text = tokens[i + 1].children
        ?.filter((c: Token) => c.type === 'text' || c.type === 'code_inline')
        .map((c: Token) => c.content)
        .join('')
        .trim()
      if (text) return text.slice(0, 120)
    }
  }
  return null
}
