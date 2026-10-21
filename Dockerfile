# Node 22+ 才有内置的 node:sqlite，这里用 24
FROM node:24-alpine AS base

# ---------------------------------- 依赖 ----------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall 要复制 pdf.js worker，这一步还没有 scripts/，先跳过
RUN npm ci --ignore-scripts

# ---------------------------------- 构建 ----------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 拿到源码之后再放 worker：public/ 是 gitignore 的，镜像里必须现生成
RUN node scripts/copy-pdf-worker.mjs && npm run build

# ---------------------------------- 运行 ----------------------------------
FROM base AS runner
WORKDIR /app

# su-exec 用来在 entrypoint 里从 root 降权到 node
RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_PATH=/app/data/shoebox.db \
    STORAGE_DIR=/app/data/storage

# standalone 产物自带精简过的 node_modules，不需要再装依赖
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# standalone 不会带上 public/，pdf.js 的 worker 就在里面
COPY --from=builder /app/public ./public

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/app/data"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
