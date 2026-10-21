/**
 * Single-user password gate. No user table, no session store: the cookie is an
 * expiry timestamp plus an HMAC of it keyed by the password itself, so changing
 * APP_PASSWORD invalidates every outstanding session for free.
 *
 * Uses Web Crypto only — this runs in Edge middleware as well as route handlers.
 */

export const COOKIE = 'shoebox_session'
export const MAX_AGE = 60 * 60 * 24 * 30 // 30 days

const encoder = new TextEncoder()

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD
}

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function issueToken(): Promise<string> {
  const expiry = String(Date.now() + MAX_AGE * 1000)
  return `${expiry}.${await hmac(process.env.APP_PASSWORD!, expiry)}`
}

export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const [expiry, signature] = token.split('.')
  if (!expiry || !signature) return false
  const ts = Number(expiry)
  if (!Number.isFinite(ts) || ts < Date.now()) return false
  return constantTimeEqual(signature, await hmac(process.env.APP_PASSWORD!, expiry))
}

/** Compares HMACs rather than the raw strings, so it can't leak length or prefix. */
export async function passwordMatches(input: string): Promise<boolean> {
  const [got, want] = await Promise.all([
    hmac(input, 'login'),
    hmac(process.env.APP_PASSWORD!, 'login'),
  ])
  return constantTimeEqual(got, want)
}
