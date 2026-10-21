#!/usr/bin/env node
/**
 * 校验纯 JS 的 SHA-256 实现。
 *
 *   node scripts/sha256-check.mjs
 *
 * 这个实现只在非安全上下文（局域网 HTTP）下才会被用到，平时跑不到，
 * 所以必须有独立的校验：先对 FIPS 180-4 的标准向量，再和 Node 自己的
 * crypto 对随机数据逐一比对。
 */
import { createHash, randomBytes } from 'node:crypto'
import { sha256Hex } from '../src/lib/sha256.ts'

let failures = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) console.log(`    实际 ${got}\n    期望 ${want}`)
}

const encoder = new TextEncoder()

// FIPS 180-4 标准向量
const vectors = [
  ['空字符串', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    '两个分组（56 字节，padding 边界）',
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
  [
    '112 字节',
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
]
for (const [label, input, want] of vectors) {
  check(label, sha256Hex(encoder.encode(input)), want)
}
check(
  '一百万个 a',
  sha256Hex(encoder.encode('a'.repeat(1_000_000))),
  'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
)

// 长度边界：55/56/63/64/65 正好卡在 padding 的分界上
for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
  const bytes = randomBytes(n)
  const want = createHash('sha256').update(bytes).digest('hex')
  check(`随机 ${n} 字节`, sha256Hex(new Uint8Array(bytes)), want)
}

// 真实页面大小的数据
for (const size of [150 * 1024, 2 * 1024 * 1024]) {
  const bytes = randomBytes(size)
  const want = createHash('sha256').update(bytes).digest('hex')
  const started = performance.now()
  const got = sha256Hex(new Uint8Array(bytes))
  const ms = (performance.now() - started).toFixed(0)
  check(`随机 ${(size / 1024 / 1024).toFixed(2)} MB（${ms}ms）`, got, want)
}

console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项失败。`)
process.exit(failures === 0 ? 0 : 1)
