#!/usr/bin/env node
/**
 * 校验 markdown 渲染：XSS 过滤、图片只能来自附件、上传端和渲染端的图片地址一致。
 *
 *   npm run check        （或 node --import ./scripts/ts-resolve.mjs scripts/markdown-check.mjs）
 */
import { renderMarkdown } from '../src/lib/markdown.ts'
import { findImageRefs, firstHeading } from '../src/lib/markdown-refs.ts'

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? `\n    ${detail}` : ''}`)
}

const noImages = () => undefined

console.log('— XSS —')
const attacks = [
  ['<script>', '<script>alert(1)</script>', /<script/i],
  ['事件处理器', '<img src="x" onerror="alert(1)">', /onerror/i],
  // markdown-it refuses the link and leaves it as plain text, which is safe:
  // what must never appear is the scheme inside an href.
  ['javascript: 链接', '[点我](javascript:alert(1))', /href\s*=\s*["']?\s*javascript:/i],
  ['HTML 里的 javascript: 链接', '<a href="javascript:alert(1)">x</a>', /href\s*=\s*["']?\s*javascript:/i],
  ['大小写混淆', '<a href="JaVaScRiPt:alert(1)">x</a>', /href\s*=\s*["']?\s*javascript:/i],
  ['实体编码混淆', '<a href="&#106;avascript:alert(1)">x</a>', /href\s*=\s*["']?\s*javascript:/i],
  ['iframe', '<iframe src="https://evil.example"></iframe>', /<iframe/i],
  ['style 属性', '<p style="position:fixed;inset:0">盖住页面</p>', /style=/i],
  ['svg onload', '<svg onload="alert(1)"><circle/></svg>', /onload|<svg/i],
  ['data: 链接', '<a href="data:text/html,<script>alert(1)</script>">x</a>', /data:text/i],
  ['object/embed', '<object data="x.swf"></object><embed src="x.swf">', /<object|<embed/i],
  ['form', '<form action="https://evil.example"><input name=p></form>', /<form|<input/i],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">', /<meta/i],
]
for (const [label, input, bad] of attacks) {
  const out = renderMarkdown(input, noImages)
  check(`拦截 ${label}`, !bad.test(out), out)
}

console.log('\n— 图片 —')
{
  const src = '![拓扑图](./images/topology.png)'
  const [ref] = findImageRefs(src)
  const out = renderMarkdown(src, (s) => (s === ref ? '/api/files/pages/ab/abc.webp' : undefined))
  check('附件图片换成存储地址', out.includes('src="/api/files/pages/ab/abc.webp"') && out.includes('loading="lazy"'), out)
}
{
  const out = renderMarkdown('![徽章](https://img.shields.io/badge/x-y-green)', noImages)
  check('未上传的远程图片不加载，换成 alt 文字', !out.includes('<img') && out.includes('［图片：徽章］'), out)
}
{
  const out = renderMarkdown('<img src="https://tracker.example/p.gif">', noImages)
  check('HTML 里的远程图片同样不加载', !out.includes('<img') && out.includes('［图片缺失］'), out)
}
{
  const out = renderMarkdown('<img src="./a.png" width="320" alt="面板">', (s) => (s === './a.png' ? '/x.webp' : undefined))
  check('HTML <img> 保留 width', out.includes('width="320"') && out.includes('src="/x.webp"'), out)
}

console.log('\n— 上传端与渲染端地址一致 —')
{
  // 中文路径、带空格的路径（CommonMark 要求写成 <…>）都会被 markdown-it
  // 规范化成百分号编码；HTML 属性里的 &amp; 要解码
  const src =
    '![](图片/面板.png)\n\n![](<图片/背面 细节.png>)\n\n<img src="a.png?x=1&amp;y=2">\n\n```\n![示例](不是图片.png)\n```'
  const refs = findImageRefs(src)
  const seen = new Set()
  renderMarkdown(src, (s) => {
    seen.add(s)
    return undefined
  })
  check('代码块里的“图片”不算引用', !refs.some((r) => r.includes('%E4%B8%8D%E6%98%AF') || r.includes('不是图片')), JSON.stringify(refs))
  check(
    '找到的每个地址都和渲染时一致',
    refs.length === 3 && refs.every((r) => seen.has(r)) && seen.size === 3,
    `upload=${JSON.stringify(refs)} render=${JSON.stringify([...seen])}`,
  )
}

console.log('\n— 排版 —')
{
  const out = renderMarkdown('| 型号 | 功率 |\n|---|---|\n| K13 | 5W |', noImages)
  check('表格', out.includes('<table>') && out.includes('<td>K13</td>'), out)
}
{
  const out = renderMarkdown('```bash\nnpm run dev\n```', noImages)
  check('代码块保留语言 class', out.includes('class="language-bash"'), out)
}
{
  const out = renderMarkdown('见 [官网](https://www.mi.com)', noImages)
  check('外链新窗口打开且带 noopener', out.includes('target="_blank"') && out.includes('rel="noopener noreferrer"'), out)
}
{
  const out = renderMarkdown('<details><summary>展开</summary>内容</details>', noImages)
  check('details/summary 保留', out.includes('<details>') && out.includes('<summary>'), out)
}
check('取第一个标题作默认标题', firstHeading('前言\n\n# 蓝牙音响 `K13` 说明\n\n## 其他') === '蓝牙音响 K13 说明')
check('没有标题时返回 null', firstHeading('只有正文') === null)

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项失败。`)
process.exit(failures === 0 ? 0 : 1)
