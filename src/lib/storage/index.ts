import { createLocalDriver } from './local'
import { createR2Driver } from './r2'
import type { DriverName, StorageDriver } from './types'

export * from './types'

let cached: StorageDriver | null = null

export function getStorage(): StorageDriver {
  if (cached) return cached
  const name = (process.env.STORAGE_DRIVER || 'local').toLowerCase() as DriverName
  cached = name === 'r2' ? createR2Driver() : createLocalDriver()
  return cached
}

/** Resolve many keys at once — signed URLs are generated in parallel. */
export async function urlsFor(keys: string[]): Promise<Map<string, string>> {
  const storage = getStorage()
  const entries = await Promise.all(keys.map(async (k) => [k, await storage.url(k)] as const))
  return new Map(entries)
}
