import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { StorageDriver } from './types'

export function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR || './storage')
}

/** Resolve a key under the storage root, refusing anything that escapes it. */
export function resolveKey(key: string): string {
  const root = storageRoot()
  const full = resolve(join(root, key))
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`key escapes storage root: ${key}`)
  }
  return full
}

export function createLocalDriver(): StorageDriver {
  return {
    name: 'local',
    supportsPresign: false,

    async put(key, body) {
      const full = resolveKey(key)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, body)
    },

    async get(key) {
      return readFile(resolveKey(key))
    },

    async presignPut() {
      throw new Error('local driver has no presigned uploads; POST to /api/files/upload instead')
    },

    async url(key) {
      return `/api/files/${key}`
    },

    async downloadUrl(key, name) {
      return `/api/files/${key}?name=${encodeURIComponent(name)}`
    },

    async remove(key) {
      await rm(resolveKey(key), { force: true })
    },

    async has(key) {
      try {
        await access(resolveKey(key))
        return true
      } catch {
        return false
      }
    },
  }
}
