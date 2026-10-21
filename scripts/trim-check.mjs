#!/usr/bin/env node
/**
 * 校验白边检测与裁剪决策。
 *
 *   node scripts/trim-check.mjs
 *
 * 用合成图覆盖容易出错的边界：灰尘点、透明边、偏灰的纸、空白页、
 * 满版页，以及最要紧的一条——正常页边距不能被裁（否则阅读器里字号会跳）。
 */
import { findContentBox, planTrim } from '../src/lib/trim.ts'

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`)
}

function canvas(width, height, [r, g, b, a = 255] = [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }
  return { data, width, height }
}

function fill(img, x0, y0, w, h, [r, g, b, a = 255]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * img.width + x) * 4
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = a
    }
  }
}

console.log('— 内容检测 —')

{
  const img = canvas(1000, 1400)
  fill(img, 50, 450, 900, 500, [20, 20, 20])
  const box = findContentBox(img, { padding: 0 })
  check('边界框贴合内容', box?.x === 50 && box.y === 450 && box.width === 900 && box.height === 500, JSON.stringify(box))
}

check('空白页返回 null', findContentBox(canvas(800, 1100)) === null)

{
  const img = canvas(1000, 1400)
  fill(img, 100, 500, 800, 400, [0, 0, 0])
  fill(img, 5, 5, 2, 2, [0, 0, 0])
  fill(img, 990, 1390, 3, 3, [40, 40, 40])
  const box = findContentBox(img, { padding: 0 })
  check('边距里的灰尘点被忽略', box.x === 100 && box.y === 500 && box.height === 400, JSON.stringify(box))
}

{
  const img = canvas(600, 800, [0, 0, 0, 0])
  fill(img, 100, 300, 400, 200, [200, 30, 30])
  const box = findContentBox(img, { padding: 0 })
  check('透明边当背景', box.x === 100 && box.y === 300 && box.width === 400, JSON.stringify(box))
}

{
  const img = canvas(1000, 1400, [242, 241, 238])
  fill(img, 200, 400, 600, 600, [225, 225, 220])
  const box = findContentBox(img, { padding: 0 })
  check('偏灰纸是背景、浅灰照片是内容', box.x === 200 && box.y === 400 && box.width === 600, JSON.stringify(box))
}

console.log('\n— 裁剪决策 —')

// 扫描 App 的典型产物：横向内容居中放在竖版 A4 上
{
  const img = canvas(1131, 1600)
  fill(img, 0, 456, 1131, 688, [30, 30, 30])
  const box = planTrim(img)
  check('扫描件：裁掉上下白带', box && box.y < 456 && box.y + box.height > 1144 && box.height < 800, JSON.stringify(box))
  check('扫描件：宽度保持不变（阅读器缩放不变）', box?.x === 0 && box.width === 1131)
}

// 最要紧的一条：正常说明书页的页边距不能动
{
  const img = canvas(1200, 1600)
  fill(img, 90, 110, 1020, 1380, [40, 40, 40]) // 四边各约 7%
  check('正常页边距（约 7%）不裁', planTrim(img) === null)
}

// 章节最后一页：内容只占上半截
{
  const img = canvas(1200, 1600)
  fill(img, 90, 110, 1020, 520, [40, 40, 40])
  const box = planTrim(img)
  check(
    '半页内容：只裁底部，顶部和左右页边距保留',
    box && box.x === 0 && box.y === 0 && box.width === 1200 && box.height < 700,
    JSON.stringify(box),
  )
}

// 左右都是大白带（竖拍的照片放在更宽的画布上）
{
  const img = canvas(1600, 1200)
  fill(img, 400, 30, 800, 1140, [40, 40, 40])
  const box = planTrim(img)
  check('左右大白带：裁左右、保留上下', box && box.x > 300 && box.width < 900 && box.y === 0 && box.height === 1200, JSON.stringify(box))
}

{
  const img = canvas(800, 1100, [30, 30, 30])
  check('满版内容不裁', planTrim(img) === null)
}

check('空白页不裁', planTrim(canvas(800, 1100)) === null)

{
  const img = canvas(1000, 1400)
  fill(img, 480, 680, 40, 40, [0, 0, 0])
  check('孤立小记号不裁（保留面积 < 5%）', planTrim(img) === null)
}

{
  const img = canvas(1000, 1400)
  fill(img, 200, 400, 600, 600, [0, 0, 0])
  const box = planTrim(img, { padding: 0.02 })
  check('裁掉的边保留 2% 留白（短边 1000 → 20px）', box?.x === 180 && box.y === 380 && box.width === 640, JSON.stringify(box))
}

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项失败。`)
process.exit(failures === 0 ? 0 : 1)
