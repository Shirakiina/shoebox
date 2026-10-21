#!/usr/bin/env node
/**
 * End-to-end check against a running dev server:
 * upload → dedupe probe → create manual → read back → serve blob → delete.
 *
 *   npm run dev            # in one terminal
 *   node scripts/smoke-test.mjs
 */
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:3000'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// Carry the session cookie through every request when a password is configured.
let cookie = ''
const rawFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const res = await rawFetch(url, {
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  })
  const set = res.headers.getSetCookie?.()
  if (set?.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
  return res
}

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Minimal RGB PNG so the test needs no image library. */
function makePng(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (r + x) % 256
      raw[row + 2 + x * 3] = (g + y) % 256
      raw[row + 3 + x * 3] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
let failures = 0

function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

async function upload(buf) {
  const hash = sha(buf)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'image/png' }), 'page.png')
  form.append('hash', hash)
  const res = await fetch(`${BASE}/api/files/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`)
  return { hash, ...(await res.json()) }
}

// 0. password gate
if (process.env.APP_PASSWORD) {
  const blocked = await fetch(`${BASE}/api/manuals`)
  check('未登录时接口被拦截', blocked.status === 401, `status=${blocked.status}`)

  const wrong = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'definitely-not-it' }),
  })
  check('错误密码被拒绝', wrong.status === 401)

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  })
  check('正确密码登录', login.ok && cookie.includes('shoebox_session'))
} else {
  console.log('· 未设置 APP_PASSWORD，跳过登录检查')
}

const pageA = makePng(60, 80, [200, 30, 30])
const pageB = makePng(60, 80, [30, 200, 30])

// 1. upload two pages
const a = await upload(pageA)
const b = await upload(pageB)
check('上传两页', !!a.key && !!b.key, `${a.key}`)

// 2. hash tampering is rejected
const bad = new FormData()
bad.append('file', new Blob([pageA], { type: 'image/png' }), 'x.png')
bad.append('hash', 'f'.repeat(64))
const badRes = await fetch(`${BASE}/api/files/upload`, { method: 'POST', body: bad })
check('篡改的 hash 被拒绝', badRes.status === 400)

// 3. create the manual
const created = await fetch(`${BASE}/api/manuals`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '冒烟测试说明书',
    category: '测试',
    keywords: '博世 SMOKE-1 洗碗机，厨房 嵌入式,洗碗机',
    pages: [a, b].map((p) => ({
      hash: p.hash,
      key: '',
      mime: 'image/png',
      size: p.size,
      width: 60,
      height: 80,
      originalSize: p.size * 10,
    })),
  }),
})
const { id, error } = await created.json()
check('创建说明书', created.ok && !!id, error ?? id)

// 4. read it back
const detail = await (await fetch(`${BASE}/api/manuals/${id}`)).json()
check('读取详情', detail.manual?.title === '冒烟测试说明书' && detail.pages.length === 2)
check('页序正确', detail.pages[0].hash === a.hash && detail.pages[1].hash === b.hash)

// 5. blob is served with the right type
const blobRes = await fetch(`${BASE}${detail.pages[0].key.startsWith('/') ? '' : '/api/files/'}${detail.pages[0].key}`)
const served = Buffer.from(await blobRes.arrayBuffer())
check('本地文件可访问', blobRes.ok && sha(served) === a.hash, blobRes.headers.get('content-type') ?? '')

// 6. dedupe probe sees both
const probe = await (
  await fetch(`${BASE}/api/files/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: [a.hash, b.hash, '0'.repeat(64)] }),
  })
).json()
check('去重探测', probe.existing.length === 2)

// 7. a second manual reusing page A must not duplicate the blob
const reuse = await fetch(`${BASE}/api/manuals`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '复用同一页',
    pages: [{ hash: a.hash, key: '', mime: 'image/png', size: a.size }],
  }),
})
const { id: reuseId } = await reuse.json()
check('复用已有页面', reuse.ok && !!reuseId)

// 8. keywords are normalised: mixed separators split, duplicates dropped
check('关键词规范化', detail.manual.keywords === '博世, SMOKE-1, 洗碗机, 厨房, 嵌入式', detail.manual.keywords)

// 9. combined search across every metadata field
const search = async (q) =>
  (await (await fetch(`${BASE}/api/manuals?q=${encodeURIComponent(q)}`)).json()).manuals

check('搜型号', (await search('SMOKE-1')).some((m) => m.id === id))
check('搜关键词', (await search('嵌入式')).some((m) => m.id === id))
check('搜分类', (await search('测试')).some((m) => m.id === id))
// One term matches only the title, the other only the keywords.
check('多词跨字段 AND', (await search('冒烟 厨房')).some((m) => m.id === id))
const inCategory = async (c, q = '') =>
  (await (await fetch(`${BASE}/?c=${encodeURIComponent(c)}&q=${encodeURIComponent(q)}`)).text())
check('按分类筛选命中', (await inCategory('测试')).includes(`/m/${id}`))
check('别的分类里没有它', !(await inCategory('名片')).includes(`/m/${id}`))
check('少一个词就不匹配', (await search('博世 冰箱')).every((m) => m.id !== id))
check('无关词不匹配', (await search('完全不存在')).length === 0)

// 10. editing metadata
const patch = async (body) =>
  fetch(`${BASE}/api/manuals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const edited = await patch({ title: '改名后的说明书', keywords: '博世;冰箱;制冷 冰箱' })
const { manual: afterEdit } = await edited.json()
check('编辑标题', edited.ok && afterEdit.title === '改名后的说明书', afterEdit?.title)
check('编辑时关键词也规范化', afterEdit.keywords === '博世, 冰箱, 制冷', afterEdit.keywords)
// category was not in the body, so it must survive untouched
check('未提交的字段保持不变', afterEdit.category === '测试', afterEdit.category)
check('页面不受影响', (await (await fetch(`${BASE}/api/manuals/${id}`)).json()).pages.length === 2)
check('旧关键词不再命中', (await search('嵌入式')).every((m) => m.id !== id))
check('新关键词可搜到', (await search('制冷')).some((m) => m.id === id))

const blank = await patch({ title: '   ' })
check('空标题被拒绝', blank.status === 400)
check('拒绝后数据未变', (await (await fetch(`${BASE}/api/manuals/${id}`)).json()).manual.title === '改名后的说明书')

const missing = await fetch(`${BASE}/api/manuals/does-not-exist`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'x' }),
})
check('编辑不存在的说明书返回 404', missing.status === 404)

// 11. page editing: reorder, append, remove
const pageC = makePng(60, 80, [30, 30, 200])
const c = await upload(pageC)

const putPages = async (pages) =>
  fetch(`${BASE}/api/manuals/${id}/pages`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages }),
  })

const page = (p, extra = {}) => ({ hash: p.hash, key: '', mime: 'image/png', size: p.size, ...extra })

// B, A, C — reversed plus one appended
const reordered = await putPages([page(b), page(a), page(c)])
const { pages: newPages, blobsRemoved } = await reordered.json()
check('重排并追加页面', reordered.ok && newPages.length === 3, `blobsRemoved=${blobsRemoved}`)
check(
  '新顺序正确',
  newPages[0].hash === b.hash && newPages[1].hash === a.hash && newPages[2].hash === c.hash,
)
check('重排不删任何文件', blobsRemoved === 0)

// Drop C — it is referenced nowhere else, so its blob must go too
const dropped = await putPages([page(b), page(a)])
const afterDrop = await dropped.json()
check('移除页面回收其文件', dropped.ok && afterDrop.blobsRemoved === 1, `removed=${afterDrop.blobsRemoved}`)
const gone = await (
  await fetch(`${BASE}/api/files/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: [c.hash] }),
  })
).json()
check('被移除页面的文件已不存在', gone.existing.length === 0)

check('空页面列表被拒绝', (await putPages([])).status === 400)
check('非法 hash 被拒绝', (await putPages([{ hash: 'zz', key: '', mime: 'image/png', size: 1 }])).status === 400)
check(
  '给不存在的说明书改页面返回 404',
  (
    await fetch(`${BASE}/api/manuals/nope/pages`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: [page(a)] }),
    })
  ).status === 404,
)

// 12. markdown pages with embedded images
async function uploadBlob(buf, mime, name) {
  const hash = sha(buf)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: mime }), name)
  form.append('hash', hash)
  const res = await fetch(`${BASE}/api/files/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`)
  return { hash, ...(await res.json()) }
}
const filePart = (f, mime) => ({ hash: f.hash, key: '', mime, size: f.size })
const createManualWith = async (title, pages) =>
  fetch(`${BASE}/api/manuals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, pages }),
  })
const fileExists = async (hash) =>
  (
    await (
      await fetch(`${BASE}/api/files/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: [hash] }),
      })
    ).json()
  ).existing.length === 1

const figure = await upload(makePng(40, 30, [10, 120, 200]))
const mdSource = [
  '# 路由器速查',
  '',
  '管理地址 **192.168.1.1**，见下图：',
  '',
  '![面板](./images/panel.png)',
  '',
  '| 指示灯 | 含义 |',
  '|---|---|',
  '| 红 | 断网 |',
  '',
  '<script>window.__pwned = 1</script>',
  '<img src="x" onerror="window.__pwned=1">',
  '[恶意](javascript:alert(1))',
].join('\n')
const mdA = await uploadBlob(Buffer.from(mdSource, 'utf8'), 'text/markdown', 'router.md')
check('上传 markdown', mdA.key.endsWith('.md'), mdA.key)

const mdCreated = await createManualWith('路由器速查', [
  { ...filePart(mdA, 'text/markdown'), attachments: [{ ...filePart(figure, 'image/png'), src: './images/panel.png' }] },
])
const { id: mdId } = await mdCreated.json()
check('创建 markdown 说明书', mdCreated.ok && !!mdId)

const html = await (await fetch(`${BASE}/m/${mdId}`)).text()
check('服务端渲染出标题与表格', html.includes('路由器速查') && html.includes('<table>') && html.includes('断网'))
check('嵌入图指向附件', html.includes(figure.key), figure.key)
check('渲染结果里没有 <script>', !/<script>window\.__pwned/.test(html))
check('渲染结果里没有 onerror', !/onerror=/.test(html))
check('渲染结果里没有 javascript: 链接', !/href="javascript:/i.test(html))

const rawMd = await fetch(`${BASE}/api/files/${mdA.key}`)
check(
  'markdown 源文件以 text/markdown + nosniff 下发',
  rawMd.headers.get('content-type')?.startsWith('text/markdown') && rawMd.headers.get('x-content-type-options') === 'nosniff',
  `${rawMd.headers.get('content-type')} / ${rawMd.headers.get('x-content-type-options')}`,
)

// Guard rails on the payload
const notMarkdown = await createManualWith('x', [
  { ...filePart(a, 'image/png'), attachments: [{ ...filePart(figure, 'image/png'), src: 'x.png' }] },
])
check('非 markdown 页带附件被拒绝', notMarkdown.status === 400)
const phantom = await createManualWith('x', [
  { ...filePart(mdA, 'text/markdown'), attachments: [{ hash: 'e'.repeat(64), key: '', mime: 'image/png', size: 1, src: 'y.png' }] },
])
check('附件没上传时被拒绝', phantom.status === 409)

// Reordering the page list must not drop the markdown's images
await fetch(`${BASE}/api/manuals/${mdId}/pages`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pages: [filePart(mdA, 'text/markdown'), filePart(b, 'image/png')] }),
})
check('编辑页面列表后附件仍在', await fileExists(figure.hash))
check('编辑后仍渲染出嵌入图', (await (await fetch(`${BASE}/m/${mdId}`)).text()).includes(figure.key))

// A second markdown manual embedding the same figure
const mdB = await uploadBlob(Buffer.from('# 另一份\n\n![](fig.png)', 'utf8'), 'text/markdown', 'other.md')
const { id: mdId2 } = await (
  await createManualWith('另一份', [
    { ...filePart(mdB, 'text/markdown'), attachments: [{ ...filePart(figure, 'image/png'), src: 'fig.png' }] },
  ])
).json()

await fetch(`${BASE}/api/manuals/${mdId}`, { method: 'DELETE' })
check('删掉一份后，共用的图还在', await fileExists(figure.hash))
check('删掉的那份 markdown 被回收', !(await fileExists(mdA.hash)))

const lastDel = await (await fetch(`${BASE}/api/manuals/${mdId2}`, { method: 'DELETE' })).json()
check('两份都删掉后，图片也被回收', !(await fileExists(figure.hash)), `removed=${lastDel.blobsRemoved}`)
check('markdown 与图片一起回收（2 个文件）', lastDel.blobsRemoved === 2, `removed=${lastDel.blobsRemoved}`)

// 13. web import guards
const inspect = async (url) =>
  fetch(`${BASE}/api/import/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })

check('导入拒绝 localhost', (await inspect('http://127.0.0.1/')).status === 400)
check('导入拒绝云元数据地址', (await inspect('http://169.254.169.254/')).status === 400)
check('导入拒绝 file://', (await inspect('file:///etc/passwd')).status === 400)
check(
  '图片代理拒绝私网',
  (await fetch(`${BASE}/api/import/fetch?url=${encodeURIComponent('http://10.0.0.1/x.png')}`))
    .status === 400,
)

// 13b. arbitrary files: stored as-is, downloadable, never served as themselves
const docx = Buffer.from(`PK\u0003\u0004 smoke ${Date.now()}`)
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const docxUp = await uploadBlob(docx, docxMime, '报价单.docx')
check('任意文件可上传', docxUp.key.endsWith('.bin'), docxUp.key)
const htmlBytes = Buffer.from(`<script>alert(1)</script> ${Date.now()}`)
const htmlUp = await uploadBlob(htmlBytes, "text/html", "evil.html")
const fileCreated = await createManualWith('张三的名片', [
  { ...filePart(a, 'image/png'), name: 'card-front.png' },
  { ...filePart(docxUp, docxMime), name: '报价单.docx' },
  { ...filePart(htmlUp, 'text/html'), name: 'evil.html' },
])
const { id: fileId } = await fileCreated.json()
check('图片和任意文件混在一份资料里', fileCreated.ok && !!fileId)
const filePages = (await (await fetch(`${BASE}/api/manuals/${fileId}`)).json()).pages
check('保留原文件名', filePages[1]?.name === '报价单.docx', filePages[1]?.name)
check('保留原始类型', filePages[1]?.mime === docxMime, filePages[1]?.mime)
check('按文件名能搜到', (await search('报价单')).some((m) => m.id === fileId))

const htmlServed = await fetch(`${BASE}/api/files/${htmlUp.key}`)
check(
  '上传的 HTML 不会按 HTML 返回',
  htmlServed.headers.get('content-type') === 'application/octet-stream' &&
    (htmlServed.headers.get('content-disposition') ?? '').startsWith('attachment'),
  `${htmlServed.headers.get('content-type')} / ${htmlServed.headers.get('content-disposition')}`,
)
const dl = await fetch(`${BASE}/api/files/${docxUp.key}?name=${encodeURIComponent('报价单.docx')}`)
check(
  '下载带原文件名',
  sha(Buffer.from(await dl.arrayBuffer())) === docxUp.hash &&
    (dl.headers.get('content-disposition') ?? '').includes(encodeURIComponent('报价单.docx')),
  dl.headers.get('content-disposition') ?? '',
)
const detailHtml = await (await fetch(`${BASE}/m/${fileId}`)).text()
check('详情页显示文件卡片', detailHtml.includes('file-card') && detailHtml.includes('报价单.docx'))
const fileDel = await (await fetch(`${BASE}/api/manuals/${fileId}`, { method: 'DELETE' })).json()
// Page A is still used by the first manual; the docx and the html go.
check('删除后回收任意文件', fileDel.blobsRemoved === 2, `removed=${fileDel.blobsRemoved}`)

// 14. deleting the first manual keeps page A (still referenced), drops page B
const del = await (await fetch(`${BASE}/api/manuals/${id}`, { method: 'DELETE' })).json()
check('删除时只回收无引用文件', del.blobsRemoved === 1, `removed=${del.blobsRemoved}`)

const after = await (
  await fetch(`${BASE}/api/files/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: [a.hash, b.hash] }),
  })
).json()
check('A 保留 / B 回收', after.existing.length === 1 && after.existing[0] === a.hash)

// cleanup
await fetch(`${BASE}/api/manuals/${reuseId}`, { method: 'DELETE' })

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项失败。`)
process.exit(failures === 0 ? 0 : 1)
