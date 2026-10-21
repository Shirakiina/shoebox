import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * These endpoints take a URL from the client, so they are an SSRF surface even
 * behind the password gate: without these checks anyone who can reach the site
 * could use it to probe the host's private network.
 */

const BLOCKED_MESSAGE = '只允许抓取公网的 http/https 地址'

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  )
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]
  if (addr === '::' || addr === '::1') return true
  if (addr.startsWith('fe80') || addr.startsWith('fc') || addr.startsWith('fd')) return true
  // IPv4-mapped, e.g. ::ffff:127.0.0.1
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIPv4(mapped[1]) : false
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('地址格式不对')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(BLOCKED_MESSAGE)

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(host)
  const addresses = literal
    ? [{ address: host, family: literal }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error(`解析不了域名：${host}`)
      })

  for (const { address, family } of addresses) {
    const isPrivate = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address)
    if (isPrivate) throw new Error(BLOCKED_MESSAGE)
  }
  return url
}

export type SafeFetchResult = { body: Buffer; contentType: string; url: string }

export async function safeFetch(
  raw: string,
  { maxBytes, accept }: { maxBytes: number; accept?: RegExp },
): Promise<SafeFetchResult> {
  const url = await assertPublicUrl(raw)

  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: {
      // Some CDNs serve nothing to an unknown agent.
      'User-Agent': 'Mozilla/5.0 (compatible; shoebox/1.0)',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`)

  // A redirect can land somewhere private, so re-check where we ended up.
  if (res.url && res.url !== url.toString()) await assertPublicUrl(res.url)

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (accept && !accept.test(contentType)) {
    throw new Error(`不是预期的类型：${contentType || '未知'}`)
  }

  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`文件过大（${(declared / 1024 / 1024).toFixed(1)}MB）`)
  }

  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > maxBytes) throw new Error('文件过大')

  return { body, contentType, url: res.url || url.toString() }
}
