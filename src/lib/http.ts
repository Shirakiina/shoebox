/**
 * The error message a failed response carries, whatever shape it came in.
 *
 * Our routes answer errors as JSON { error }, but not every failure reaches
 * them: a body cut off by a size limit, a proxy's HTML page, a crash with an
 * empty body. Calling res.json() on those threw "Unexpected end of JSON
 * input" and hid the real problem, so read text and parse defensively.
 */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  let text = ''
  try {
    text = await res.text()
  } catch {
    /* body unreadable */
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed?.error === 'string' && parsed.error) return parsed.error
  } catch {
    /* not JSON */
  }
  if (res.status === 413) return `${fallback}：文件太大（HTTP 413）`
  return `${fallback}（HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}）`
}
