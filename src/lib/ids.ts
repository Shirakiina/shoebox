const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz' // no l/o, easier to read back

export function newId(len = 12): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

export const HASH_RE = /^[0-9a-f]{64}$/
