'use client'

import type { CompressOptions } from '@/lib/compress'

export default function CompressOptionsPanel({
  value,
  onChange,
}: {
  value: CompressOptions
  onChange: (next: CompressOptions) => void
}) {
  const set = (patch: Partial<CompressOptions>) => onChange({ ...value, ...patch })

  return (
    <div className="panel">
      <h2>压缩设置</h2>
      <div className="opts">
        <div>
          <label htmlFor="maxEdge">最长边 (px)</label>
          <input
            id="maxEdge"
            type="number"
            min={600}
            max={4000}
            step={100}
            value={value.maxEdge}
            onChange={(e) => set({ maxEdge: Number(e.target.value) || 1600 })}
          />
        </div>
        <div>
          <label htmlFor="quality">画质 {Math.round(value.quality * 100)}</label>
          <input
            id="quality"
            type="range"
            min={30}
            max={95}
            value={Math.round(value.quality * 100)}
            onChange={(e) => set({ quality: Number(e.target.value) / 100 })}
          />
        </div>
        <div>
          <label htmlFor="format">格式</label>
          <select
            id="format"
            value={value.format}
            onChange={(e) => set({ format: e.target.value as CompressOptions['format'] })}
          >
            <option value="image/webp">WebP（更小）</option>
            <option value="image/jpeg">JPEG（兼容性最好）</option>
          </select>
        </div>
        <div>
          <label htmlFor="pdfMode">PDF 处理</label>
          <select
            id="pdfMode"
            value={value.pdf}
            onChange={(e) => set({ pdf: e.target.value as CompressOptions['pdf'] })}
          >
            <option value="auto">自动（能明显变小才拆）</option>
            <option value="always">总是拆成图片</option>
            <option value="never">原样保存</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, paddingBottom: 6 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={value.trim}
              onChange={(e) => set({ trim: e.target.checked })}
            />
            裁掉白边
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.grayscale}
              onChange={(e) => set({ grayscale: e.target.checked })}
            />
            灰度（黑白页更省）
          </label>
        </div>
      </div>
      <p className="sub" style={{ margin: '12px 0 0' }}>
        设置改动后需要重新选择文件才会生效。PDF 选「自动」时会先抽几页估算，转成图片能省 40% 以上才拆；
        超宽的折页会按版块切成多页。拆成图片后原有的可选中文字不会保留。
      </p>
    </div>
  )
}
