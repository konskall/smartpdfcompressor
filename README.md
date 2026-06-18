# Smart PDF Compressor

> Συμπίεση PDF δωρεάν online — compress PDF files in your browser with no quality loss.

A lightweight web app for compressing PDF files. Users drag-and-drop one or more PDFs, pick a compression level, and the files are compressed in the cloud via the **Adobe PDF Services API** and downloaded back automatically. The interface is in Greek and processes files in batches with live per-file progress.

<p align="center">
  <img src="SmartPDFCompressor.png" alt="Smart PDF Compressor preview" width="640">
</p>

<p align="center">
  <a href="https://konskall.github.io/smartpdfcompressor/"><img alt="Live Demo" src="https://img.shields.io/badge/live-demo-2563eb?style=flat-square"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white">
  <img alt="Adobe PDF Services" src="https://img.shields.io/badge/Adobe-PDF%20Services%20API-FA0F00?style=flat-square&logo=adobe&logoColor=white">
  <img alt="No build step" src="https://img.shields.io/badge/frontend-vanilla%20JS-f7df1e?style=flat-square&logo=javascript&logoColor=black">
</p>

---

## 🔗 Live

| Layer | URL |
|-------|-----|
| **Frontend** (GitHub Pages) | <https://konskall.github.io/smartpdfcompressor/> |
| **Backend API** (Render.com) | <https://pdf-compress-api-dl83.onrender.com> |

> ℹ️ The backend runs on a free Render tier, so the **first request after a period of inactivity may take ~30–60s** while the server wakes from sleep (cold start).

---

## ✨ Features

### Batch processing
- Always-visible drop zone — add **multiple PDFs at once** by drag-and-drop or file picker.
- Responsive **card grid**: 3 columns on desktop, 2 on tablet (≤900px), 1 on mobile (≤600px).
- Each card shows the filename, **page count**, original size, and a state-specific UI.
- **Sequential processing queue** that respects the Adobe rate limit, with **auto-download** on completion.

### Per-card states
| State | Indicator | Body |
|-------|-----------|------|
| `pending` | gray border | "Σε αναμονή" + remove (×) button |
| `processing` | blue border | upload progress bar / "Επεξεργασία αρχείου…" |
| `done` | green border | compressed size, −% saved, **Λήψη** + **↺ Ξανά** buttons |
| `error` | red border | error message + **↺ Δοκιμή ξανά** button |

### Quality of life
- **Dark mode** with a header toggle, `localStorage` persistence, and `prefers-color-scheme` fallback.
- **Drag-and-drop reorder** of pending cards before processing.
- **Download all as ZIP** (via JSZip) when 2+ files are done.
- **Summary bar** — total files completed and MB / % saved.
- **Rate-limit pill** in the header showing remaining requests (turns red when ≤3 left).
- **Recompress** (↺ Ξανά) and **Clear completed** (Καθαρισμός) actions.
- Compression level and theme **persisted** across sessions.
- `Enter` keyboard shortcut to start compression.
- Subtle card entrance / status animations.

### Privacy
- Uploaded files are stored only **temporarily** on the server and **deleted immediately** after the compressed file is sent back.
- A background janitor purges any leftover temp files older than **30 minutes** (e.g. after a crash).
- No accounts, no tracking of file contents.

---

## 🏗️ Architecture

```
 Browser (GitHub Pages)                    Render.com (Node)              Adobe Cloud
┌────────────────────────┐  multipart    ┌──────────────────────┐  SDK  ┌──────────────────┐
│  index.html            │ ─── POST ────▶ │  server.js (Express) │ ────▶ │  PDF Services    │
│  vanilla JS UI + queue │  /api/compress │  multer + rateLimit  │       │  Compress PDF    │
│  JSZip (CDN)           │ ◀── PDF ─────  │  temp file + cleanup │ ◀──── │  job             │
└────────────────────────┘   download     └──────────────────────┘       └──────────────────┘
```

The frontend and backend are deployed **independently**:

- **Frontend** — a single static `index.html` (HTML + CSS + JS, no build step) served from GitHub Pages. The backend URL is hardcoded in `index.html` as `API_URL`.
- **Backend** — a small Express server that accepts the upload, calls the Adobe PDF Services API, streams the compressed result back, and cleans up temp files.

---

## 🧰 Tech stack

| Area | Technology |
|------|------------|
| Frontend | Vanilla JavaScript (ES2020), HTML, CSS custom properties — **no framework, no build** |
| ZIP bundling | [JSZip](https://stuk.github.io/jszip/) (loaded from CDN) |
| Backend | Node.js, [Express](https://expressjs.com/) |
| File uploads | [Multer](https://github.com/expressjs/multer) |
| Compression | [@adobe/pdfservices-node-sdk](https://www.npmjs.com/package/@adobe/pdfservices-node-sdk) |
| Hardening | [express-rate-limit](https://www.npmjs.com/package/express-rate-limit), [cors](https://www.npmjs.com/package/cors), [dotenv](https://www.npmjs.com/package/dotenv) |
| Hosting | GitHub Pages (frontend) · Render.com (backend) |

---

## 📁 Project structure

```
smartpdfcompressor/
├── index.html          # Entire frontend: markup, styles, and JS (~995 lines)
├── server.js           # Express backend: /api/compress + /api/health
├── devserver.js        # Tiny static dev server for previewing index.html locally
├── package.json        # Scripts and dependencies
├── package-lock.json
├── robots.txt          # SEO
├── sitemap.xml         # SEO
├── site.webmanifest    # PWA manifest
├── favicon*.png / .ico  # App icons
├── SmartPDFCompressor.png  # Open Graph / preview image
└── google…html         # Google Search Console verification
```

> `.env`, `node_modules/`, and `uploads/` are intentionally **git-ignored**.

---

## 🚀 Getting started (local development)

### Prerequisites
- **Node.js 18+** and npm
- **Adobe PDF Services API credentials** (free tier available) — create them at the [Adobe Developer Console](https://developer.adobe.com/document-services/apis/pdf-services/). You will get a **Client ID** and **Client Secret**.

### 1. Install dependencies
```bash
git clone https://github.com/konskall/smartpdfcompressor.git
cd smartpdfcompressor
npm install
```

### 2. Configure environment variables
Create a `.env` file in the project root:

```ini
PDF_SERVICES_CLIENT_ID=your_adobe_client_id
PDF_SERVICES_CLIENT_SECRET=your_adobe_client_secret
# Optional — defaults to 3000
PORT=3000
```

> The server **refuses to start** if either Adobe credential is missing.

### 3. Run the backend
```bash
npm start        # node server.js   → http://localhost:3000
# or, with auto-reload during development:
npm run dev      # nodemon server.js
```

### 4. Preview the frontend
```bash
npm run serve    # node devserver.js → serves index.html on http://localhost:3000
```

> ⚠️ Both `server.js` and `devserver.js` default to port **3000**, so don't run them on the same port at once.
> By default `index.html` points `API_URL` at the production Render backend. To test the frontend against your **local** backend, change `API_URL` near the top of the script section in `index.html` to `http://localhost:3000` (this origin is already allowed by CORS).

---

## 📡 API reference

### `POST /api/compress`
Compresses a single PDF and returns the compressed file.

**Request** — `multipart/form-data`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `pdf` | file | ✅ | Must be `application/pdf`, **≤ 10 MB** |
| `compressionLevel` | text | — | `LOW` · `MEDIUM` (default) · `HIGH` |

**Response**
- `200` — the compressed PDF as a file download (`compressed.pdf`).
- `400` — no file provided / not a PDF.
- `429` — rate limit exceeded (more than **20 requests / 15 minutes** per IP).
- `500` — Adobe API or processing error (JSON `{ "error": "…" }`).

**Example**
```bash
curl -X POST https://pdf-compress-api-dl83.onrender.com/api/compress \
  -F "pdf=@document.pdf" \
  -F "compressionLevel=MEDIUM" \
  -o compressed.pdf
```

### `GET /api/health`
Simple health check.
```json
{ "status": "ok", "message": "Server is running" }
```

---

## ⚙️ Configuration & limits

| Setting | Value | Where |
|---------|-------|-------|
| Max file size | **10 MB** per file | enforced client-side (`index.html`) and server-side (multer) |
| Compression levels | `LOW`, `MEDIUM`, `HIGH` | mapped to Adobe `CompressionLevel` |
| Rate limit | **20 requests / 15 min per IP** | `express-rate-limit` |
| Allowed CORS origins | `https://konskall.github.io`, `http://localhost:3000` | `server.js` |
| Temp-file retention | deleted on send; janitor purges > 30 min | `server.js` |

---

## ☁️ Deployment

### Frontend → GitHub Pages
The static `index.html` (plus icons, manifest, `robots.txt`, `sitemap.xml`) is served from GitHub Pages at `konskall.github.io/smartpdfcompressor`. Pushing to `main` publishes the site.

### Backend → Render.com
Deploy `server.js` as a Node web service:
- **Build command:** `npm install`
- **Start command:** `node server.js`
- **Environment variables:** `PDF_SERVICES_CLIENT_ID`, `PDF_SERVICES_CLIENT_SECRET`

> On the free tier the service sleeps after inactivity, so the first request triggers a cold start. The app already shows per-card progress while this happens.

---

## 🔒 Privacy & data handling

PDFs are uploaded to the backend only for the duration of compression, sent to Adobe's cloud for processing, returned to the user, and then **immediately deleted** from the server. Nothing is persisted, logged with its contents, or shared. A periodic cleanup task removes any orphaned temp files older than 30 minutes.

---

## 📝 License

No license file is currently included, so all rights are reserved by the author. If you intend to make this openly reusable, consider adding an [MIT license](https://choosealicense.com/licenses/mit/).

---

## 👤 Author

**KonsKall** — [github.com/konskall](https://github.com/konskall)

Built with the [Adobe PDF Services API](https://developer.adobe.com/document-services/apis/pdf-services/).
