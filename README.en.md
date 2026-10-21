# Shoebox

English · [中文](README.md)

**A self-hosted home for the paperwork you want to keep.** Manuals, receipts, business cards, warranty cards, IDs, contracts — snap a photo or drag a file in. Images are compressed in your browser before upload, identical files are stored once, and everything is a keyword search away.

Plenty of households keep a shoebox stuffed with manuals, receipts and warranty cards, and digging through it takes forever. Shoebox is the digital version: smaller, and much easier to search.

> The UI is in Simplified Chinese.

## Features

- **Originals never leave your machine.** Images are resized and re-encoded to WebP in the browser before upload. A 3–5 MB phone photo of a page ends up around 150–250 KB.
- **Content-addressed dedupe.** Every file is named by its sha256. Uploading the same page again is instant and costs one database row.
- **PDFs are split only when it pays off.** Scanned PDFs are rendered to image pages and compressed (a 6-page scan went from 7.38 MB to 590 KB); text PDFs are kept as-is.
- **Fold-out sheets and long images are cut into pages.** A flattened multi-panel leaflet is split at the panel boundaries; tall images are cut between paragraphs.
- **Automatic margin trimming.** Removes the big white bands scanner apps add above and below a photo, without touching normal page margins.
- **Markdown with its images.** Local, remote and base64 images referenced by a document are stored with it, so opening it never makes an outbound request.
- **Any other file, stored verbatim.** Word, Excel, archives and so on sit alongside image pages in the same item and can be downloaded.
- **Import from a web page.** Paste the URL of an online manual and its images become an item. The server-side fetcher is SSRF-hardened.
- **Multi-term search across fields.** Title, category, keywords, notes and original file names are searched together. Every space-separated term must match, but each can match a different field.
- **Continuous reader.** All pages are stitched into one scrolling view; landscape, portrait and square pages keep their aspect ratio.
- **Two storage backends.** Local disk, or Cloudflare R2 (presigned direct uploads from the browser, optional CDN delivery). You can migrate between them at any time.
- **Light to run.** The database is Node's built-in `node:sqlite`, so there are no native dependencies. The Docker image ships only the Next.js standalone output.
- Single-password protection, light and dark themes.

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/Shirakiina/shoebox.git
cd shoebox
cp .env.example .env        # set APP_PASSWORD at minimum
docker compose up -d --build
```

Open <http://localhost:3000>. The database and files live in `./data/` on the host; copying that directory is a full backup.

By default the container only listens on `127.0.0.1`. To expose it to your LAN or other hosts, add this to `.env`:

```
SHOEBOX_BIND=0.0.0.0:3000
```

### Local development

Requires **Node ≥ 22.5** (the first release with `node:sqlite`).

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. Files go to `./storage/` and metadata to `./data/shoebox.db` by default.

## Configuration

Use `.env.local` for local development and `.env` for Docker.

| Variable | Default | Description |
|---|---|---|
| `APP_PASSWORD` | empty | Access password. Empty means no protection — anyone can get in |
| `STORAGE_DRIVER` | `local` | `local` for disk, `r2` for Cloudflare R2 |
| `STORAGE_DIR` | `./storage` | File directory for the `local` driver (fixed to `/app/data/storage` in Docker) |
| `DB_PATH` | `./data/shoebox.db` | SQLite database path (fixed to `/app/data/shoebox.db` in Docker) |
| `R2_ACCOUNT_ID` | empty | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | empty | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | empty | R2 API token secret key |
| `R2_BUCKET` | `shoebox` | R2 bucket name |
| `R2_PUBLIC_BASE` | empty | Optional public domain for the bucket, see [Switching to Cloudflare R2](#switching-to-cloudflare-r2) |
| `SHOEBOX_BIND` | `127.0.0.1:3000` | Docker Compose only: host listen address |
| `TZ` | `Asia/Shanghai` | Docker Compose only: container time zone |

The password is read at runtime: restart the process (or `docker compose restart`) after changing it, no rebuild needed.

## How it works

### Upload pipeline

```
Browser: split PDF → trim margins → resize + encode WebP → sha256 → ask the server which files it already has
       → upload only the missing ones (presigned direct upload to R2, bytes never pass through the app) → save metadata
```

The server recomputes each hash and rejects mismatches. The upload page and both editors ("edit info" and "manage pages") share one client pipeline (`src/lib/upload-client.ts`), so the three entry points cannot drift apart.

### Organizing items

Each item has exactly four fields: **title, category, keywords, notes**. Business cards don't get dedicated "phone" or "company" fields — put those in keywords or notes and they are just as searchable, and the form doesn't grow with every new kind of document.

- **Category** says what the item is (manual, business card, receipt, contract…). The home page shows one tab per category, and tabs combine with search.
- **Keywords**: as many as you like, separated by commas, Chinese enumeration commas, semicolons or spaces; they are deduplicated and normalized on save. While typing you get suggestions from keywords already in the library.
- **Search** matches the title, category, keywords, notes and every page's original file name as one combined text. Searching `bosch kitchen` finds an item with "bosch" in the title and "kitchen" in its keywords.

### PDFs

Scanned PDFs are often bigger than photos, because every page is a high-resolution JPEG. These are rendered page by page in the browser with pdf.js and sent through the same compression pipeline as photos. Once split they are ordinary pages: reorderable, deletable and deduplicated.

The decision is based purely on size, never on guessing what kind of PDF it is:

- ≥ 600 KB per page on average: images will certainly be smaller, so split
- ≤ 120 KB per page on average: can't get smaller, so keep as-is
- In between: encode 3 sample pages with the current settings, estimate the total, and split only if it saves 40% or more

The "PDF handling" option on the upload page overrides this (always split / keep as-is). Splitting drops the PDF's selectable text. pdf.js (1.5 MB) is loaded on demand, so uploading photos never downloads it.

### Fold-outs and long images

PDF pages and images with an aspect ratio above 2.2 are first rendered at low resolution to find divider lines or gaps between panels (`src/lib/split.ts`), then cut into pages; with no visible divider they are cut evenly at the emptiest positions. Tall images are handled the same way, cut in the gaps between paragraphs. Adjacent panels are rendered together as one strip and cut afterwards, so pdf.js doesn't replay the whole page's drawing operations for every panel. A 22.9 MB, 12-panel fold-out manual ends up as 12 pages totalling 637 KB.

### Trimming margins

Phone scanner apps often place a landscape photo on a portrait A4 page, leaving the top and bottom blank. Before compression the content bounds are detected and the page is **cropped first, then scaled**, so the whole resolution budget goes to the content. Each edge is judged separately and only cropped when its blank band exceeds 12% of that dimension, so normal margins stay intact and text size stays consistent within an item. Existing items can be trimmed afterwards via "manage pages → trim margins".

### Markdown

A `.md` file can be uploaded as a page and mixed with image and PDF pages. Images it references are resolved like this:

| Reference | Handling |
|---|---|
| `![](./images/panel.png)` relative path | Looked up by path or file name among the files dropped in the same batch |
| `https://…` remote image | Downloaded through the server's SSRF-hardened proxy |
| `data:image/png;base64,…` | Decoded directly |
| SVG | Rasterized and stored |

Found images are compressed and deduplicated as usual and stored as attachments of that page. The stored `.md` is the original file, unmodified. Rendering happens on the server: markdown-it parses it and sanitize-html filters it against an allowlist. Common HTML such as `<img width>` and `<details>` is allowed, while `<script>`, event handlers, `style`, `iframe` and `javascript:` links are stripped.

### Other files

Files other than images, PDFs and Markdown are stored verbatim and shown in the reader as a file card with a download button; the download keeps the original file name. These files are **download-only and never opened in the browser**: they are stored as `.bin` and served with `application/octet-stream` and `Content-Disposition: attachment`, so an uploaded `.html` or `.svg` cannot run scripts on the site with your session.

### Importing from a web page

Many vendors publish manuals as web pages. Paste the URL into "import from web page" on the upload page: the page title becomes the item title, the source URL goes into the notes, and the images become pages in document order. The server only proxies the downloads; compression, dedupe and upload still run through the browser pipeline. Images whose shorter side is under 100 px (usually tracking pixels) are skipped.

### Reading and editing

- Pages scroll as one continuous document; thumbnails on the left jump to a page, ← → keys flip pages, and you can open the current page's original image.
- **Edit info** changes title, category, keywords and notes in place (`PATCH /api/manuals/:id`).
- **Manage pages** lets you drag to reorder, delete, append pages or import another web page; nothing is written until you click save (`PUT /api/manuals/:id/pages`). Files no longer referenced by any item are removed from storage.
- The header toggles between system / light / dark themes. The theme is applied before first paint, so reloading doesn't flash.

## Switching to Cloudflare R2

**1. Create a bucket and credentials.** Create an R2 bucket in the Cloudflare dashboard, then create an **Object Read & Write** token under R2 → Manage API Tokens.

**2. Configure:**

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=xxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxx
R2_BUCKET=shoebox
R2_PUBLIC_BASE=          # optional
```

**3. Configure CORS on the bucket** (needed for direct browser uploads; bucket Settings → CORS Policy):

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

Add your production origin to `AllowedOrigins` once deployed.

**4. Move existing files:**

```bash
npm run sync:r2 -- --dry   # see what would be uploaded
npm run sync:r2            # upload
```

Storage keys are content hashes and identical under both drivers, so the database needs no changes: set `STORAGE_DRIVER=r2` and restart.

**Should you set `R2_PUBLIC_BASE`?**

- **No**: every access gets a server-signed URL valid for 1 hour. The bucket stays private, but images can't be CDN-cached.
- **Yes**: bind a custom domain to the bucket (or enable `r2.dev` public access) and set e.g. `https://files.example.com`. Images are served from Cloudflare's edge and R2 doesn't charge for egress. Note that anyone with a URL can then view the image without logging in.

## Deploying and upgrading

The suggested setup is a git checkout on the server, upgraded with `scripts/deploy.sh`:

```bash
ssh <server> '<repo-dir>/scripts/deploy.sh'
```

It runs `git reset --hard origin/main`, builds the image, snapshots the database into `data/backups/` with `VACUUM INTO` (keeping the latest 10), restarts the container and waits for the health check. `.env` and `data/` are not in the repository, so upgrades never touch them.

### Merging two libraries

`scripts/import-library.mjs` merges another Shoebox library into the current one — for example to move your local library onto a server. It works at the database level, so ids and creation times are preserved; files are content-addressed, so running it twice never creates duplicates.

```bash
# 1. Export a clean snapshot (VACUUM INTO includes writes still sitting in the WAL)
mkdir -p /tmp/shoebox-export
node -e "const{DatabaseSync}=require('node:sqlite');
         new DatabaseSync('./data/shoebox.db').prepare('VACUUM INTO ?').run('/tmp/shoebox-export/shoebox.db')"
cp -R storage /tmp/shoebox-export/storage

# 2. Run on the target; check with --dry first, then drop it
node scripts/import-library.mjs /tmp/shoebox-export/shoebox.db /tmp/shoebox-export/storage --dry
```

For a Docker target: the image doesn't contain `scripts/`, so copy the export together with the script into the host's `./data/_import/` (`/app/data/_import/` inside the container), run `docker compose exec -T shoebox node /app/data/_import/import-library.mjs …`, and delete the directory afterwards.

## Security

- **One password, no session store.** The cookie is an expiry time plus an HMAC keyed by the password, so changing the password signs out every device at once. Eight failed attempts lock logins for one minute.
- **Files require login too.** With a password set, every page and API route requires a session, including the `/api/files/...` image URLs.
- **Arbitrary uploads are download-only** and never served as their claimed type, preventing stored XSS.
- **Markdown is rendered through an allowlist sanitizer.**
- **SSRF protection.** Web import and remote Markdown images go through `src/lib/safe-fetch.ts`, which resolves the host and rejects loopback, private ranges, link-local (including the cloud metadata address `169.254.169.254`), CGNAT and non-http(s) schemes, re-checking the target after every redirect.
- **Use HTTPS.** Over plain HTTP the password and cookie travel in clear text. `crypto.subtle` is also only available on HTTPS or localhost, which is why a pure-JS SHA-256 fallback (`src/lib/sha256.ts`) is included so uploads still work over LAN HTTP.

## Development and tests

```bash
npm run check                    # unit checks: sha256, margin trimming, Markdown rendering & XSS, panel splitting
npm run dev                      # in another terminal
node scripts/smoke-test.mjs      # end-to-end API test, BASE_URL defaults to http://localhost:3000
```

The smoke test covers the login gate, uploads, hash verification, create and read, dedupe, keyword normalization, multi-term search, editing, page reorder / append / delete (including orphaned-file cleanup), Markdown attachments, XSS in rendered pages and SSRF protection. If `APP_PASSWORD` is set it logs in automatically.

`next dev` and `next build` fight over the same `.next` directory. To run two instances at once, give the second one its own output directory:

```bash
NEXT_DIST_DIR=.next-test PORT=3101 npx next dev
```

## Project layout

```
src/lib/upload-client.ts   Browser pipeline: split PDF → compress → hash → dedupe probe → upload
src/lib/compress.ts        Resize, grayscale, re-encode, sha256
src/lib/pdf.ts             pdf.js wrapper: size-based split decision, strip rendering
src/lib/split.ts           Panel splitting for very wide / tall pages
src/lib/trim.ts            Margin detection and per-edge crop decisions
src/lib/markdown-refs.ts   Markdown parser config and image reference extraction (shared by browser and server)
src/lib/markdown.ts        Server-side rendering + allowlist sanitizing
src/lib/safe-fetch.ts      SSRF protection for outbound fetches
src/lib/sha256.ts          SHA-256 fallback for insecure contexts
src/lib/db.ts              SQLite schema, combined search, migrations
src/lib/storage/           local | r2 drivers behind one interface
src/lib/auth.ts            HMAC-signed session cookie
src/middleware.ts          Login guard
src/app/(app)/             Signed-in pages
src/app/api/               File, item, import and auth endpoints
src/components/            Upload form, reader, page editor and more
scripts/                   R2 migration, library merge, deploy, tests
```

## Known limitations

- One password only: no multiple users, share links or read-only accounts.
- Chrome and Firefox can't decode HEIC; convert iPhone photos to JPEG first or upload from Safari. HEIC files are still stored verbatim.
- 64 MB per file. For larger PDFs choose "always split into images".
- Images referenced by Markdown must be dropped in together with the document and are matched by file name; with duplicate names the first one wins. Markdown can't be edited in the browser.
- Web import only picks up images; text-only pages can't be imported.
- Search is a `LIKE` scan — instant up to a few thousand items, but larger libraries would need a different approach.

## License

[MIT](LICENSE)
