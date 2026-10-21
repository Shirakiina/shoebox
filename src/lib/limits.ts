/**
 * Largest single file the server accepts through /api/files/upload.
 *
 * Keep next.config.mjs's middlewareClientMaxBodySize a little above this: the
 * auth middleware buffers request bodies, and Next cuts anything past that
 * limit (10 MB by default) *silently* — the route then gets a truncated form
 * and fails to parse it. With R2 the browser uploads straight to the bucket and
 * this limit doesn't apply.
 */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024
