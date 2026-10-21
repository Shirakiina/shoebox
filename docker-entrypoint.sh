#!/bin/sh
# 以 root 进入：先把挂载进来的数据目录准备好，再降权到 node 用户跑应用。
# 挂载卷的属主由宿主决定，容器里必须有权限写，否则 SQLite 一上来就失败。
set -e

DB="${DB_PATH:-/app/data/shoebox.db}"
STORE="${STORAGE_DIR:-/app/data/storage}"
DB_DIR="$(dirname "$DB")"

mkdir -p "$DB_DIR" "$STORE"
# 已有文件属主可能对不上（尤其 Linux 宿主的 bind mount），统一交给 node
chown -R node:node "$DB_DIR" 2>/dev/null || true

for dir in "$DB_DIR" "$STORE"; do
  if ! su-exec node test -w "$dir"; then
    echo "错误：$dir 不可写。请检查挂载目录的权限。" >&2
    exit 1
  fi
done

if [ -z "$APP_PASSWORD" ]; then
  echo "[entrypoint] 警告：未设置 APP_PASSWORD，站点不设防，任何人都能访问。" >&2
fi

echo "[entrypoint] 数据库 $DB"
echo "[entrypoint] 文件目录 $STORE"

exec su-exec node "$@"
