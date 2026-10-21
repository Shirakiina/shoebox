# 鞋盒 Shoebox

[English](README.en.md) · 中文

**自托管的个人资料收纳站。** 说明书、发票、名片、保修卡、证件、合同，或者任何想留一份的文件，拍照或拖进来就行：图片在浏览器里压缩好再上传，同样的文件只存一份，以后按关键词随时翻出来。

很多人家里都有一个鞋盒，专门塞说明书、发票和保修卡，要用的时候翻半天。Shoebox 是它的数字版，只是更小、更好找。

## 特点

- **原图不离开你的电脑**：图片在浏览器里缩放、重编码成 WebP 后才上传。手机直拍一页 3–5 MB，处理完约 150–250 KB。
- **内容寻址去重**：每个文件按 sha256 命名，同一页再传一次直接秒传，只多一条数据库记录。
- **PDF 按体积决定拆不拆**：扫描版 PDF 拆成图片页再压缩（实测 6 页扫描件 7.38 MB → 590 KB），文字版 PDF 原样保存。
- **折页、长图自动切开**：一整张摊平的折页说明书会按版块切成多页，竖长图在段落之间切开。
- **自动裁白边**：只裁扫描件上下大片的白，正常页边距不动。
- **Markdown 连图一起入库**：文档引用的本地、远程、base64 图片都会存下来，打开时不向外网发任何请求。
- **任意文件原样保存**：Word、Excel、压缩包等文件和图片页放在同一份资料里，可以下载。
- **从网页导入**：粘贴一个在线说明书的网址，把页面里的图片抓成一份资料。服务端带 SSRF 防护。
- **跨字段多词搜索**：在标题、分类、关键词、备注和原文件名里一起找，空格分隔的每个词都要命中，但可以落在不同字段。
- **连续阅读**：所有页面拼成一整页往下滚，横版、竖版、方形混排都不变形。
- **两种存储**：本地磁盘，或 Cloudflare R2（浏览器预签名直传，图片可以走 CDN）。随时可以迁移。
- **部署很轻**：数据库用 Node 内置的 `node:sqlite`，没有原生依赖。Docker 镜像只带 Next.js standalone 产物。
- 单密码保护，浅色 / 深色主题。

## 快速开始

### Docker（推荐）

```bash
git clone https://github.com/Shirakiina/shoebox.git
cd shoebox
cp .env.example .env        # 至少填上 APP_PASSWORD
docker compose up -d --build
```

打开 <http://localhost:3000>。数据库和文件都放在宿主的 `./data/` 下，复制这个目录就是一次完整备份。

默认只监听 `127.0.0.1`。要让局域网或其他机器访问，在 `.env` 里加：

```
SHOEBOX_BIND=0.0.0.0:3000
```

### 本地开发

需要 **Node ≥ 22.5**（`node:sqlite` 从这个版本开始提供）。

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 <http://localhost:3000>。默认文件落在 `./storage/`，元数据在 `./data/shoebox.db`。

## 配置

本地开发写在 `.env.local`，Docker 部署写在 `.env`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `APP_PASSWORD` | 空 | 访问密码。留空则不设防，任何人都能访问 |
| `STORAGE_DRIVER` | `local` | `local` 存本机磁盘，`r2` 存 Cloudflare R2 |
| `STORAGE_DIR` | `./storage` | `local` 驱动的文件目录（Docker 里固定为 `/app/data/storage`） |
| `DB_PATH` | `./data/shoebox.db` | SQLite 数据库位置（Docker 里固定为 `/app/data/shoebox.db`） |
| `R2_ACCOUNT_ID` | 空 | Cloudflare 账户 ID |
| `R2_ACCESS_KEY_ID` | 空 | R2 API 令牌的 Access Key |
| `R2_SECRET_ACCESS_KEY` | 空 | R2 API 令牌的 Secret Key |
| `R2_BUCKET` | `shoebox` | R2 存储桶名 |
| `R2_PUBLIC_BASE` | 空 | 可选，桶的公开访问域名，见[切到 Cloudflare R2](#切到-cloudflare-r2) |
| `SHOEBOX_BIND` | `127.0.0.1:3000` | 仅 Docker Compose：宿主上的监听地址 |
| `TZ` | `Asia/Shanghai` | 仅 Docker Compose：容器时区 |

密码在运行时读取，改完重启进程或 `docker compose restart` 即可，不用重新构建。

## 它是怎么工作的

### 上传流水线

```
浏览器：拆 PDF → 裁白边 → 缩放 + 编码 WebP → 算 sha256 → 问服务端哪些已存在
     → 只传缺的（R2 走预签名直传，字节不经过本服务）→ 提交元数据
```

服务端会重算 hash，对不上就拒绝。上传页、「编辑信息」和「管理页面」共用同一条客户端流水线（`src/lib/upload-client.ts`），三个入口的行为一致。

### 资料的组织

每份资料只有四个字段：**标题、分类、关键词、备注**。名片不单独设「电话」「公司」字段，写进关键词或备注一样能搜到，表单也不会随着资料类型变多而越来越长。

- **分类**表示这是什么资料（说明书、名片、发票、合同……）。首页按分类分成标签页，可以和搜索叠加。
- **关键词**可以打任意多个，逗号、顿号、分号、空格都能分隔，保存时去重并规范化。输入时会提示库里已经用过的词。
- **搜索**把标题、分类、关键词、备注和所有页面的原文件名拼在一起匹配。搜「博世 厨房」能找到标题里有「博世」、关键词里有「厨房」的那份。

### PDF

扫描版 PDF 往往比照片还大，因为每页都是一张高分辨率 JPEG。这类 PDF 会在浏览器里用 pdf.js 逐页渲染，拆成图片页后走和照片相同的压缩流程。拆开之后就是普通页面，可以排序、删除、参与去重。

拆不拆只看体积，不去猜 PDF 是什么类型：

- 平均每页 ≥ 600 KB：转图片肯定更小，直接拆
- 平均每页 ≤ 120 KB：不可能更小，原样保存
- 介于两者之间：抽 3 页按当前压缩设置实际编码，估算能省 40% 以上才拆

上传页的「PDF 处理」可以改成「总是拆」或「原样保存」。拆成图片后，原来能选中的文字不会保留。pdf.js（1.5 MB）按需加载，只传照片时不会下载它。

### 折页和长图

长宽比超过 2.2 的 PDF 页和图片，会先低分辨率渲染一遍，寻找版块之间的分隔线或空白（`src/lib/split.ts`），切成若干页；找不到分隔线时就在最空的位置均匀切开。竖长图同理，在段落间隙切。相邻版块合成一条一起渲染再切开，避免 pdf.js 对每个版块重复执行整页的绘图指令。一份 22.9 MB 的 12 折说明书，最终切成 12 页、共 637 KB。

### 裁白边

手机扫描 App 常把横拍的照片放进 A4 竖版页面，上下全是白。压缩前会先检测内容边界，**先裁后缩**，分辨率全部留给内容。每条边单独判断，空白超过该方向的 12% 才裁，所以正常页边距不会被裁掉，同一份资料里的字号也不会忽大忽小。已上传的资料可以在「管理页面 → 裁掉白边」里补裁。

### Markdown

`.md` 文件可以当作一页上传，和图片页、PDF 页混排。文档里引用的图片按这张表处理：

| 写法 | 处理方式 |
|---|---|
| `![](./images/panel.png)` 相对路径 | 在同一批拖进来的文件里按路径或文件名查找 |
| `https://…` 远程图片 | 通过服务端的防 SSRF 代理下载 |
| `data:image/png;base64,…` | 直接解码 |
| SVG | 栅格化后保存 |

找到的图片照常压缩、去重，作为这一页的附件保存。保存的 `.md` 是原文件本身，正文没有被改写。渲染在服务端完成：markdown-it 解析，sanitize-html 白名单过滤。允许 `<img width>`、`<details>` 这类常见 HTML，但 `<script>`、事件处理器、`style`、`iframe`、`javascript:` 链接都会被去掉。

### 其他文件

图片、PDF、Markdown 以外的文件原样保存，阅读器里显示成一张文件卡片，可以下载，下载回来还是原来的文件名。这类文件**只下载、不在浏览器里打开**：存储为 `.bin`，返回时带 `application/octet-stream` 和 `Content-Disposition: attachment`，避免上传的 `.html`、`.svg` 以登录态在本站执行脚本。

### 从网页导入

很多厂商的说明书是一个网页。把网址粘进上传页的「从网页导入」：页面标题变成资料标题，来源地址记进备注，图片按文档顺序变成页面。服务端只负责代理下载，压缩、去重、上传仍走浏览器那条流水线。短边小于 100px 的图片（多半是埋点像素）会被跳过。

### 阅读与编辑

- 所有页面拼成一整页连续滚动，左侧缩略图跳页，键盘 ← → 翻页，可以打开当前页的原图。
- **编辑信息**：就地修改标题、分类、关键词、备注（`PATCH /api/manuals/:id`）。
- **管理页面**：拖动排序、删除、追加新页面或再导入一个网页，点「保存」才写入（`PUT /api/manuals/:id/pages`）。没有任何资料再引用的文件会从存储里回收。
- 顶栏可以切换「跟随系统 / 浅色 / 深色」，首次绘制前就会应用主题，刷新不会闪。

## 切到 Cloudflare R2

**1. 建桶并拿到凭证。** 在 Cloudflare 控制台建一个 R2 存储桶，然后在 R2 → Manage API Tokens 建一个 **Object Read & Write** 令牌。

**2. 填写配置：**

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=xxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxx
R2_BUCKET=shoebox
R2_PUBLIC_BASE=          # 可选
```

**3. 给桶配置 CORS**（浏览器直传需要，在桶的 Settings → CORS Policy）：

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

上线后把正式域名加进 `AllowedOrigins`。

**4. 把已有文件搬上去：**

```bash
npm run sync:r2 -- --dry   # 先看要传哪些
npm run sync:r2            # 真正上传
```

存储 key 是内容哈希，两种驱动完全一致，所以同步完数据库不用改，切换 `STORAGE_DRIVER=r2` 后重启即可。

**`R2_PUBLIC_BASE` 填不填：**

- **不填**：每次访问由服务端签一个 1 小时有效的 URL，桶保持私有，但图片走不了 CDN 缓存。
- **填**：给桶绑一个自定义域（或开启 `r2.dev` 公开访问），填 `https://files.example.com`。图片直接走 Cloudflare 边缘，R2 不收出网流量费。注意此时知道 URL 的人不登录也能看到图片。

## 部署与升级

推荐在服务器上放一份 git checkout，用 `scripts/deploy.sh` 升级：

```bash
ssh <服务器> '<仓库目录>/scripts/deploy.sh'
```

它会依次执行：`git reset --hard origin/main`、构建镜像、用 `VACUUM INTO` 在 `data/backups/` 留一份数据库快照（保留最近 10 份）、重启容器、等健康检查通过。`.env` 和 `data/` 不在仓库里，升级不会碰它们。

### 合并两个库

`scripts/import-library.mjs` 把另一个 Shoebox 库合并进当前库，比如把本机的库搬到服务器上。它直接操作数据库，id 和创建时间原样保留；文件是内容寻址的，所以重复执行不会产生副本。

```bash
# 1. 导出一份干净的快照（VACUUM INTO 会带上 WAL 里还没落盘的写入）
mkdir -p /tmp/shoebox-export
node -e "const{DatabaseSync}=require('node:sqlite');
         new DatabaseSync('./data/shoebox.db').prepare('VACUUM INTO ?').run('/tmp/shoebox-export/shoebox.db')"
cp -R storage /tmp/shoebox-export/storage

# 2. 在目标端执行，先 --dry 看要导入什么，确认后去掉 --dry
node scripts/import-library.mjs /tmp/shoebox-export/shoebox.db /tmp/shoebox-export/storage --dry
```

如果目标是 Docker 部署：镜像里没有 `scripts/`，可以把导出目录连同脚本一起放进宿主的 `./data/_import/`（容器内是 `/app/data/_import/`），再用 `docker compose exec -T shoebox node /app/data/_import/import-library.mjs …` 执行，完成后删掉这个目录。

## 安全

- **单密码，无会话存储**：cookie 是「过期时间 + 以密码为密钥的 HMAC」，所以改密码会让所有已登录设备立即失效。连续失败 8 次锁定 1 分钟。
- **文件也要登录**：开启密码后，所有页面和接口都需要登录，包括 `/api/files/...` 图片地址。
- **上传的任意文件只能下载**，不会按它自称的类型返回，避免存储型 XSS。
- **Markdown 渲染走白名单过滤**。
- **SSRF 防护**：网页导入和 Markdown 远程图片都经过 `src/lib/safe-fetch.ts`，会解析域名并拒绝环回、私有网段、link-local（含云厂商元数据地址 `169.254.169.254`）、CGNAT 和非 http(s) 协议，重定向后重新校验目标地址。
- **建议上 HTTPS**：纯 HTTP 部署时，密码和 cookie 在网络上是明文传输的。另外 `crypto.subtle` 只在 HTTPS 或 localhost 下可用，所以项目带了一个纯 JS 的 SHA-256 兜底（`src/lib/sha256.ts`），局域网 HTTP 访问也能正常上传。

## 开发与测试

```bash
npm run check                    # 纯函数单元校验：sha256、裁白边、Markdown 渲染与 XSS、版块切分
npm run dev                      # 另开一个终端
node scripts/smoke-test.mjs      # 接口端到端自测，BASE_URL 默认 http://localhost:3000
```

冒烟测试覆盖登录拦截、上传、hash 校验、创建与读取、去重、关键词规范化、多词搜索、编辑、页面重排 / 追加 / 删除（含孤儿文件回收）、Markdown 附件、渲染页的 XSS、SSRF 防护。设置了 `APP_PASSWORD` 会自动带上登录步骤。

`next dev` 和 `next build` 会争用同一个 `.next` 目录。要同时跑两个实例，给第二个换一个输出目录：

```bash
NEXT_DIST_DIR=.next-test PORT=3101 npx next dev
```

## 项目结构

```
src/lib/upload-client.ts   浏览器端流水线：拆 PDF → 压缩 → 哈希 → 去重探测 → 上传
src/lib/compress.ts        缩放、灰度、重编码、sha256
src/lib/pdf.ts             pdf.js 封装：按体积决定拆不拆、分条渲染
src/lib/split.ts           超宽 / 超长页的版块切分
src/lib/trim.ts            白边检测与逐边裁剪决策
src/lib/markdown-refs.ts   Markdown 解析配置与图片引用提取（浏览器和服务端共用）
src/lib/markdown.ts        服务端渲染 + 白名单过滤
src/lib/safe-fetch.ts      抓取外部 URL 的 SSRF 防护
src/lib/sha256.ts          非安全上下文下的 SHA-256 兜底
src/lib/db.ts              SQLite schema、综合搜索、迁移
src/lib/storage/           local | r2 两个驱动，同一个接口
src/lib/auth.ts            HMAC 签名的会话 cookie
src/middleware.ts          登录守卫
src/app/(app)/             登录后的页面
src/app/api/               文件、资料、导入、登录接口
src/components/            上传表单、阅读器、页面编辑器等
scripts/                   R2 迁移、库合并、部署、自测
```

## 已知限制

- 只有一个密码，没有多用户、分享链接或只读账号。
- Chrome / Firefox 解不了 HEIC，iPhone 照片请先转成 JPEG，或用 Safari 上传。HEIC 文件仍会被原样保存。
- 单个文件上限 64 MB。更大的 PDF 可以选「总是拆成图片」。
- Markdown 引用的图片需要和文档一起拖进来，按文件名匹配；同名图片会取第一张。Markdown 不支持在线编辑。
- 网页导入只抓图片，纯文字网页导不进来。
- 搜索是 `LIKE` 扫描，几千份资料以内是瞬时的，更大规模需要换方案。

## License

[MIT](LICENSE)
