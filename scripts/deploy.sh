#!/usr/bin/env bash
# 在服务器上拉取最新代码并重建容器。
#
#   ssh <服务器> '<仓库目录>/scripts/deploy.sh'
#
# .env 和 data/ 不在仓库里，git 不会碰它们——所以访问密码和你的资料
# 在每次部署中都原样保留。新版本启动时可能迁移数据库结构，所以重启前
# 先在 data/backups/ 留一份快照（保留最近 10 份）。
set -euo pipefail

cd "$(dirname "$0")/.."

branch="${DEPLOY_BRANCH:-main}"

echo "▸ 拉取 $branch"
git fetch --prune origin "$branch"

before="$(git rev-parse HEAD)"
# reset 而不是 merge：服务器上不该有本地提交，要的就是和远端一模一样
git reset --hard "origin/$branch"
after="$(git rev-parse HEAD)"

if [ "$before" = "$after" ]; then
  echo "▸ 已是最新（$(git log --oneline -1)）"
else
  echo "▸ $(git --no-pager log --oneline "$before..$after" | wc -l) 个新提交："
  git --no-pager log --oneline "$before..$after"
fi

echo "▸ 构建镜像"
docker compose build

# 快照在运行中的容器里做：VACUUM INTO 会带上 WAL 里还没落盘的写入，
# 文件也归容器里的用户所有，宿主上不用管权限
if [ "$(docker inspect shoebox --format '{{.State.Running}}' 2>/dev/null)" = true ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  # 路径走环境变量，免得在 shell / JS / SQL 三层引号里打转（\x27 是 SQL 的单引号）
  docker exec -e SNAP="/app/data/backups/shoebox-$stamp.db" shoebox sh -c '
    mkdir -p /app/data/backups &&
    node -e "new (require(\"node:sqlite\").DatabaseSync)(process.env.DB_PATH).exec(\"VACUUM INTO \x27\" + process.env.SNAP + \"\x27\")" &&
    ls -1t /app/data/backups/shoebox-*.db | tail -n +11 | xargs -r rm -f
  '
  echo "▸ 数据库快照：data/backups/shoebox-$stamp.db"
fi

echo "▸ 重启容器"
docker compose up -d

echo "▸ 等待健康检查"
for _ in $(seq 1 30); do
  status="$(docker inspect shoebox --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)"
  [ "$status" = healthy ] && break
  sleep 2
done

echo "▸ $(docker compose ps --format '{{.Name}} {{.Status}}')"
[ "${status:-}" = healthy ] || { echo "健康检查未通过，最近日志："; docker compose logs --tail 30; exit 1; }
