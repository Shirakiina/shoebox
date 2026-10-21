'use client'

import { useEffect, useRef, useState } from 'react'
import type { PreparedFile } from '@/lib/upload-client'
import { isImageMime } from '@/lib/mime'

/**
 * Object URLs for locally-prepared pages, keyed by item id. They are revoked
 * when an item goes away or the component unmounts — a blob URL that is never
 * revoked pins the whole compressed image in memory.
 *
 * A fresh Map is published on every change: returning the mutated ref would
 * keep the same identity, and callers memoising on it would never recompute.
 */
export function usePreviewUrls(items: PreparedFile[]): Map<string, string> {
  const cache = useRef(new Map<string, string>())
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    const live = new Set(items.map((i) => i.id))
    let changed = false

    for (const [id, url] of cache.current) {
      if (live.has(id)) continue
      URL.revokeObjectURL(url)
      cache.current.delete(id)
      changed = true
    }
    for (const item of items) {
      if (cache.current.has(item.id)) continue
      if (!isImageMime(item.processed.mime)) continue // files and PDFs get a badge instead
      cache.current.set(item.id, URL.createObjectURL(item.processed.blob))
      changed = true
    }
    if (changed) setUrls(new Map(cache.current))
  }, [items])

  useEffect(() => {
    const urlCache = cache.current
    return () => {
      for (const url of urlCache.values()) URL.revokeObjectURL(url)
      urlCache.clear()
    }
  }, [])

  return urls
}
