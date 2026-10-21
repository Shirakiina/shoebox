'use client'

import { useMemo } from 'react'
import { parseKeywords } from '@/lib/keywords'

export type ManualMeta = {
  title: string
  category: string
  keywords: string
  notes: string
}

export const EMPTY_META: ManualMeta = {
  title: '',
  category: '',
  keywords: '',
  notes: '',
}

/** Offered even in an empty library, so the first entries get consistent names. */
const STARTER_CATEGORIES = ['说明书', '名片', '发票', '证件', '合同', '保修卡']

/** Shared by the upload form and the edit panel so the two can't drift apart. */
export default function MetaFields({
  value,
  onChange,
  suggestions,
  categories = [],
  idPrefix = '',
}: {
  value: ManualMeta
  onChange: (next: ManualMeta) => void
  suggestions: string[]
  /** Categories already in use, most common first. */
  categories?: string[]
  /** Keeps element ids unique if both instances ever share a page. */
  idPrefix?: string
}) {
  const parsed = useMemo(() => parseKeywords(value.keywords), [value.keywords])
  const id = (name: string) => `${idPrefix}${name}`
  const set = (patch: Partial<ManualMeta>) => onChange({ ...value, ...patch })
  const categoryChoices = useMemo(
    () => [...new Set([...categories, ...STARTER_CATEGORIES])],
    [categories],
  )

  return (
    <>
      <div className="field">
        <label htmlFor={id('title')}>标题 *</label>
        <input
          id={id('title')}
          type="text"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="例：美的变频空调说明书 / 张三的名片 / 租房合同 2026"
        />
      </div>

      <div className="field">
        <label htmlFor={id('category')}>分类</label>
        <input
          id={id('category')}
          type="text"
          value={value.category}
          onChange={(e) => set({ category: e.target.value })}
          placeholder="说明书 / 名片 / 发票 / 合同…"
          list={id('category-choices')}
        />
        <datalist id={id('category-choices')}>
          {categoryChoices.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="chips" style={{ marginTop: 8 }}>
          {categoryChoices.slice(0, 8).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip chip-link${value.category === c ? ' active' : ''}`}
              onClick={() => set({ category: value.category === c ? '' : c })}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor={id('keywords')}>关键词</label>
        <input
          id={id('keywords')}
          type="text"
          value={value.keywords}
          onChange={(e) => set({ keywords: e.target.value })}
          placeholder="品牌、型号、公司、人名…用逗号或空格分隔"
          list={suggestions.length ? id('keyword-suggestions') : undefined}
        />
        {suggestions.length > 0 ? (
          <datalist id={id('keyword-suggestions')}>
            {suggestions.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        ) : null}
        {parsed.length > 0 ? (
          <div className="chips" style={{ marginTop: 8 }}>
            {parsed.map((w) => (
              <span className="chip" key={w}>
                {w}
              </span>
            ))}
          </div>
        ) : (
          <p className="hint">品牌、型号、公司、电话都可以写在这里，搜索时和标题、分类、备注一起匹配</p>
        )}
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor={id('notes')}>备注</label>
        <textarea
          id={id('notes')}
          rows={2}
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="购买日期、保修期、在哪认识的、原件放在哪…"
        />
      </div>
    </>
  )
}
