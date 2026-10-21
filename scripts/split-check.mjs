#!/usr/bin/env node
/**
 * 校验超长页面的切分：折页按版块切、长图按空白行切、普通页面不动。
 *
 *   npm run check
 */
import { planSlices } from '../src/lib/split.ts'

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? `\n    ${detail}` : ''}`)
}

function canvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { data, width, height }
}
function fill(img, x0, y0, w, h, v = 30) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * img.width + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
    }
}
/**
 * A block of "text": lines of short dashes. Each line is shifted a little so,
 * as with real type, no column stays blank all the way down the block.
 */
function text(img, x0, y0, w, h) {
  for (let y = y0, line = 0; y < y0 + h - 5; y += 12, line++) {
    for (let x = x0 + ((line * 4) % 11); x < x0 + w - 8; x += 11) fill(img, x, y, 8, 5)
  }
}
const widths = (s) => s.map((t) => t.width).join(' ')

// 1. 普通比例：不切
{
  const img = canvas(1200, 1600)
  text(img, 100, 100, 1000, 1400)
  const s = planSlices(img)
  check('普通竖版页面不切', s.length === 1 && s[0].width === 1200 && s[0].height === 1600)
}
{
  const img = canvas(1600, 900)
  text(img, 60, 60, 1480, 780)
  check('普通横版页面（16:9）不切', planSlices(img).length === 1)
}

// 2. 折页：外框 + 版块之间有贯穿全高的细线（K75 那种）
{
  const img = canvas(4000, 500)
  const top = 100, h = 300, left = 50, panel = 390
  fill(img, left, top, panel * 10, 2) // 外框上
  fill(img, left, top + h - 2, panel * 10, 2) // 外框下
  for (let k = 0; k <= 10; k++) fill(img, left + k * panel, top, 2, h) // 竖线（首尾是外框）
  for (let k = 0; k < 10; k++) {
    text(img, left + k * panel + 30, top + 30, panel - 60, h - 60)
    fill(img, left + k * panel + 120, top + 40, 1, 200) // 版块内部的短竖线，不该被当成分界
  }
  const s = planSlices(img)
  check('按贯穿全高的细线切成 10 个版块', s.length === 10, widths(s))
  check('每块宽度一致（±2px）', s.every((t) => Math.abs(t.width - panel) <= 2), widths(s))
  check('外框线不产生空白碎片', s[0].x <= left + 2 && s.every((t) => t.width > 100), widths(s))
}

// 3. 折页：版块之间是白色间隔
{
  const img = canvas(3000, 600)
  for (let k = 0; k < 6; k++) text(img, 40 + k * 490, 60, 430, 480)
  const s = planSlices(img)
  check('按白色间隔切成 6 个版块', s.length === 6, widths(s))
}

// 4. 什么分隔都没有：等分，但刀口落在最空的列上
{
  const img = canvas(3600, 500)
  // 几列文字，列与列之间有 12px 的缝——窄于“白色间隔”的门槛（总宽的 0.4% ≈ 14px），
  // 所以只能靠等分 + 吸附；切口应落在缝里
  for (let k = 0; k < 9; k++) text(img, 20 + k * 398, 40, 386, 420)
  const s = planSlices(img)
  const cuts = s.slice(1).map((t) => t.x)
  const inGaps = cuts.every((x) => ((x - 20) % 398) >= 378 || ((x - 20) % 398) <= 2)
  check('无分隔时按页面宽度等分', s.length >= 4 && s.length <= 12, widths(s))
  check('等分的刀口吸附到列间缝隙，不切穿文字', inGaps, JSON.stringify(cuts))
}

// 5. 竖向长图（电商详情页那种）：按空白行切片
{
  const img = canvas(750, 6000)
  for (let y = 40; y < 5900; y += 260) text(img, 40, y, 670, 200) // 段落之间留 60px 空白
  const s = planSlices(img)
  const cutRows = s.slice(1).map((t) => t.y)
  const inBlank = cutRows.every((y) => ((y - 40) % 260) >= 196)
  check('长图切成多片', s.length >= 4, `${s.length} 片`)
  check('每片高度约为宽度的 1.3 倍（±30%）', s.every((t, i) => i === s.length - 1 || Math.abs(t.height / t.width - 1.3) < 0.4), s.map((t) => t.height).join(' '))
  check('刀口落在段落之间的空白，不切穿文字', inBlank, JSON.stringify(cutRows))
  check('切片宽度保持不变', s.every((t) => t.width === s[0].width))
}

// 6. 被切得太碎的版块并入前一块
{
  const img = canvas(3000, 500)
  const top = 50, h = 400
  for (const x of [50, 1000, 1030, 2000, 2950]) fill(img, x, top, 2, h) // 1000 与 1030 挨得太近
  text(img, 80, 80, 880, 340); text(img, 1060, 80, 900, 340); text(img, 2030, 80, 900, 340)
  const s = planSlices(img)
  check('窄于 0.3 倍高度的碎片被合并', s.every((t) => t.width >= 0.3 * 400), widths(s))
}

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项失败。`)
process.exit(failures === 0 ? 0 : 1)
