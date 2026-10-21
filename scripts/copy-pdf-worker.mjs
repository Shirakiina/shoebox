#!/usr/bin/env node
/**
 * Puts pdf.js's worker somewhere the browser can fetch by a stable path.
 *
 * Letting the bundler resolve it (`new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 * import.meta.url)`) produces a hashed asset URL that the worker request did not
 * reliably load, so the file is copied into public/ and referenced by a fixed
 * path instead. Runs on postinstall so it tracks the installed pdfjs version.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

try {
  const pdfjsEntry = require.resolve('pdfjs-dist/package.json')
  const source = join(dirname(pdfjsEntry), 'build', 'pdf.worker.min.mjs')
  if (!existsSync(source)) {
    console.warn(`[pdf-worker] 找不到 ${source}，跳过`)
    process.exit(0)
  }
  mkdirSync('public', { recursive: true })
  copyFileSync(source, join('public', 'pdf.worker.min.mjs'))
  console.log('[pdf-worker] 已复制到 public/pdf.worker.min.mjs')
} catch (err) {
  // A missing dependency must not break `npm install`.
  console.warn('[pdf-worker] 跳过：', err instanceof Error ? err.message : err)
}
