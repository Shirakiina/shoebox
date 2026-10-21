/** @type {import('next').NextConfig} */
const nextConfig = {
  // 容器里只带 standalone 产物，不装依赖，镜像小很多
  output: 'standalone',
  // Lets a second instance (a test server, or `next build` while `next dev` is
  // running) use its own output directory instead of fighting over `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // The auth middleware makes Next buffer every request body, and past this
    // limit (10 MB by default) it truncates the body silently — uploads then
    // failed with an unparseable form. Keep it a little above MAX_UPLOAD_BYTES
    // in src/lib/limits.ts to leave room for multipart overhead.
    middlewareClientMaxBodySize: '66mb',
  },
}

export default nextConfig
