# Mirova

**A minimal digital whiteboard with editable AI Sketch → Diagram.**

Mirova is the browser-facing name for this whiteboard. The source package and internal engine retain the historical `cicada` name. Draw, paste, annotate, share, and optionally ask a vision model to interpret the complete board and turn it into an editable diagram.

[Legacy Cicada demo](https://ansel-s.github.io/Cicada/)

---

## ✨ Key Features

- **Canvas tools:** Pen, text, eraser, seven colors, three stroke widths, zoom, pan, undo, and redo.
- **Shape prediction:** Smooths rough circles, triangles, rectangles, squares, and continuous arrows into clean paths.
- **Clipboard paste:** Ctrl+V pastes plain text as editable text or a copied image as a board object. Both are undoable and included in captures and share links.
- **Text formatting:** The floating text controls apply bold, italic, and underline; board text uses Absans.
- **Themes:** Persistent light and charcoal dark modes, with separate high-contrast pen palettes.
- **Screenshots:** Capture the board, preview the result, then download or copy it.
- **AI Sketch → Diagram:** Add an optional analysis hint, preview the detected structure, then replace the sketch or add the diagram beside it. Output remains native editable board strokes.
- **Shareable boards:** A versioned binary codec stores strokes and viewport state in a URL hash. Pasted images are compressed and embedded with a size limit.
- **Glass UI:** The website UI uses Geist; the Mirova favicon is a local SVG.
- **Build:** Vite bundles the app JavaScript, CSS, and fonts into `dist/index.html`; the small favicon remains a separate asset beside it.
- **Responsive input:** Mouse, pen, and touch drawing use the same imperative canvas engine.

---

## 🚀 Quick Start

### 1. Install and run

```bash
npm install
npm run dev
```

This starts both halves at once via `concurrently`:

| Process | Address | What it is |
| --- | --- | --- |
| `web` | http://localhost:5173 | Vite dev server (React + canvas engine) |
| `api` | http://localhost:8787 | Express AI backend |

Vite proxies `/api/*` to the Express server, so the browser only ever talks to one origin. **Open http://localhost:5173.**

The whiteboard is fully usable with no API server running at all — you will simply see *"AI conversion is currently unavailable"* in the panel.

### 2. Enable the AI (OpenRouter)

The AI runs through OpenRouter's standard chat-completions endpoint. Choose a model that accepts image input and returns text; rerank, embedding, moderation-only, and agentic-harness-only models are not compatible. Get an OpenRouter key at <https://openrouter.ai/keys>, then:

```bash
cp server/.env.example server/.env
```

Open `server/.env` and set the key:

```ini
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key
AI_MODEL=provider/vision-chat-model
```

Restart the API after changing `.env`. The server banner and `GET /api/health` confirm what it picked up:

```
  Cicada API  →  http://localhost:8787
  provider    →  openrouter
  model       →  provider/vision-chat-model
```

Free model routes can be temporarily rate-limited. The UI reports that separately; retry later or select another compatible model. If the model is restricted to an agentic harness, Cicada's chat-completions request will be rejected. If no key is present, AI conversion is unavailable while the local whiteboard remains usable.

### 3. Try it without a key

`AI_PROVIDER=mock` returns a canned diagram so you can exercise capture, HTTP validation, schema validation, layout, adaptation, preview, and undo without contacting a model:

```bash
AI_PROVIDER=mock npm run dev
```

### 4. Build

Generate the optimized single-file `index.html` into `dist/`:

```bash
npm run build
```

`npm start` serves `dist/` and the API from one process on port 8787.

Run the offline pipeline regression tests with:

```bash
npm test
```

---

## Board Features and Controls

The board is a three-layer canvas: a base layer for committed content and the grid, a live layer for the active stroke, and a cursor layer. Pointer movement, drawing, zoom, and pan stay inside the imperative engine; React only receives low-frequency state such as selected tool, history availability, and toast messages.

| Action | Behavior |
| --- | --- |
| `P`, `T`, `E` | Select pen, text, or eraser. |
| `Ctrl+Z` / `Cmd+Z` | Undo the latest stroke or diagram action. |
| `Ctrl+Y` / `Cmd+Shift+Z` | Redo. |
| `Space` + drag | Pan the board. |
| `0` | Reset the viewport. |
| Wheel | Pan; hold Ctrl/Cmd while scrolling to zoom. |
| `Ctrl+V` / `Cmd+V` on the board | Paste clipboard text or an image at the visible board center. |

Text is entered directly on the canvas and stored as a text stroke. Its floating B/I/U popup changes style before commit. Pen colors are theme-aware: the selected color is rendered from the corresponding palette slot, so switching themes recolors existing ink consistently. Both palettes have seven slots, and legacy saved colors retain their slot mapping.

| Theme | Palette slots in toolbar order |
| --- | --- |
| Light | `#363028` · `#8D5142` · `#4B725E` · `#4F6785` · `#79613F` · `#705779` · `#667085` |
| Dark | `#75A7FF` · `#F2C94C` · `#FF9F43` · `#FF7777` · `#9FD86B` · `#56D6C9` · `#F4F1E8` |

### Clipboard Images

Paste is handled by the canvas engine, not by an overlay. When clipboard content contains an image, Mirova prefers that image over accompanying text. Source files over 30 MB are rejected; accepted images are downscaled, converted to WebP, and capped at 750 KB of embedded data. The resulting image object has board coordinates and dimensions, participates in the renderer, AI capture, undo/redo, and share-link codec. Text paste strips control characters and caps content at 500 characters. Paste is ignored while an input or editable field has focus.

The screenshot button uses the same board renderer as AI capture. It previews a cropped image of the board content for five seconds and offers download, clipboard-copy, and dismiss actions. The Save button copies a URL containing the encoded board and viewport.

### Themes, Fonts, and Brand

Theme choice persists in `localStorage` and otherwise follows the system preference. Geist is used for website controls; the bundled Absans font is reserved for board text. `index.html` sets the browser-tab title to **Mirova** and loads the local `src/assets/cicada-mark.svg` favicon.

---

## AI Conversion: Detailed Flow

Conversion is explicit: nothing is sent until **Convert to diagram** is pressed. The optional hint is passed to the model as important guidance about the board's intended scope; visible marks remain the source for exact nodes, labels, and connections. The image contains the complete board drawing, not browser chrome or unrelated desktop content.

```text
Canvas stroke/image objects
  → captureBoard() computes content bounds and renders one PNG (max edge 1024 px, min edge 640 px)
  → optional hint is added to the user prompt
  → browser POSTs { image, hint } to /api/ai/sketch-to-diagram
  → Express rate/concurrency guards and PNG/body/hint validation
  → OpenRouter /chat/completions request with text + image_url
  → robust JSON extraction from the model response
  → authoritative server validateDiagram()
  → browser validates the returned diagram again
  → layoutDiagram() computes geometry locally (no model coordinates trusted)
  → diagramToStrokes() adapts nodes/edges to native Cicada strokes
  → same renderer captures a preview; user chooses Replace, Add beside, or Discard
  → replace uses applyStrokes(); Add beside uses appendStrokes(); both create one undo step
```

`captureBoard()` crops around board content with padding, uses the current light/dark board background, and bounds the raster size for the provider. An empty board returns `null` locally and does not send a request. An unclear drawing can return an empty semantic diagram; the client shows the model summary rather than drawing invented structure.

The server checks request shape, base64 syntax, PNG signature, byte limits, and hint type/length before the provider sees the image. The model returns semantics only. `validateDiagram()` normalizes labels/IDs/shapes, caps nodes and edges, drops malformed nodes and links to unknown IDs, and records warnings. The client repeats schema validation as defense in depth.

`layoutDiagram()` sizes labels using the board text metrics, assigns graph levels, orders nodes with neighbour barycentres, chooses top-to-bottom or left-to-right layout, and routes orthogonal edges. `diagramToStrokes()` maps rectangles, circles, diamonds, cylinders, text, labels, and arrowheads onto existing pen/circle/text stroke forms. The AI result is therefore editable with the same tools and stored by the same history and share codec.

---

## ⚙️ Environment Variables

All of these live in **`server/.env`**, which is read only by Node. None are exposed to the browser.

### Provider

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `openrouter` | `openrouter` \| `qwen` (OpenRouter alias) \| `mock` |
| `OPENROUTER_API_KEY` | *(empty)* | Your OpenRouter key. Required unless `AI_PROVIDER=mock`. |
| `AI_MODEL` | `qwen/qwen-2.5-vl-72b-instruct` | OpenRouter model ID. Must accept image input on the standard Chat Completions endpoint and return text. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Override for proxies or self-hosting. |
| `OPENROUTER_REFERER` | *(empty)* | Optional attribution header OpenRouter asks for. |
| `OPENROUTER_TITLE` | `Cicada Whiteboard` | Optional attribution header. |

### Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API listen port. |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173` | Comma-separated allowlist. `*` disables the check — local tinkering only. |
| `API_TARGET` | `http://localhost:8787` | Set at **Vite** level to point the dev proxy elsewhere. |

### Guardrails

Every limit is enforced server-side before anything reaches the model.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_MAX_IMAGE_B64` | `6000000` | Ceiling on the raw base64 payload (~4.5 MB of PNG). |
| `AI_MAX_BODY` | `7mb` | `express.json` body limit. |
| `AI_MAX_HINT` | `500` | Max characters of user hint text. |
| `AI_MAX_TOKENS` | `4000` | Completion budget. |
| `AI_TIMEOUT_MS` | `60000` | Upstream timeout; a slow model returns 504 rather than hanging. |
| `AI_RATE_WINDOW_MS` | `60000` | Rate-limit window. |
| `AI_RATE_MAX` | `12` | Requests allowed per window per IP. |
| `AI_MAX_CONCURRENT` | `3` | Global in-flight cap; excess requests get 429. |

---

## 🔒 Security Notes

**Your API key never reaches the browser.** This is enforced in three independent places, not just by convention:

1. **`server/.env` is Node-only.** Vite loads `VITE_*` from the project root and never reads `server/.env`. The key is destructured inside `server/providers/openrouter.js` at call time and is never returned, logged, or interpolated into an error message.
2. **A build-time guard fails the build.** `vite.config.js` inspects every `VITE_*` variable and refuses to build if any looks like a credential (name matches `KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|APIKEY`, or an `sk-or-…` pattern, or its *value* contains a real secret from the ambient environment). So a stray `VITE_OPENROUTER_KEY=...` cannot silently ship.
3. **`server/.env` is gitignored.**

Other hardening:

- **LLM output is never trusted.** `shared/diagramSchema.js` type-checks every field, caps array and string lengths, strips control characters, drops edges pointing at unknown nodes, and dedupes. The **server** validates before responding and the **browser** validates again before anything touches the canvas — so even a compromised or buggy backend cannot push garbage into the drawing.
- **The model returns semantics only — no coordinates.** Untrusted pixel geometry would be both unreliable and a liability, so layout is computed deterministically on the client.
- **Nothing is sent until you press Convert.** No pointer events or background uploads. One PNG containing all board content is sent per explicit click; browser chrome and unrelated desktop content are never captured.
- **If the browser disconnects, the upstream call is aborted**, so you do not pay for completions nobody is waiting for.

---

## Model Output Contract

The model is instructed to inspect the complete captured board and treat the user's hint as important guidance about scope and intent. The hint helps explain what to look for, but node labels and connections must still be supported by visible marks. An unclear or non-diagram board should produce an empty node/edge list rather than invented structure.

The server extracts JSON from plain text or fenced output, then validates it. The browser validates again before layout. Model-supplied coordinates are never accepted: the model returns semantic nodes and edges only, and the deterministic client layout computes geometry locally.

After a valid response, the panel previews the generated strokes and lets the user **Replace sketch**, **Add beside**, or **Discard result**. Replace and Add each create one undoable history operation. Ctrl/Cmd+Z restores the prior board, and redo reapplies the diagram.

### The semantic JSON

```json
{
  "version": 1,
  "title": "Order pipeline",
  "diagramType": "flowchart",
  "summary": "How an order moves from checkout to fulfilment.",
  "nodes": [
    { "id": "checkout", "label": "Checkout", "shape": "rect", "group": "frontend" },
    { "id": "is_valid", "label": "Payment OK?", "shape": "diamond" },
    { "id": "orders",   "label": "Orders DB",  "shape": "cylinder", "group": "backend" }
  ],
  "edges": [
    { "from": "checkout", "to": "is_valid", "directed": true },
    { "from": "is_valid", "to": "orders", "label": "yes", "style": "solid" },
    { "from": "is_valid", "to": "checkout", "label": "no", "style": "dashed" }
  ]
}
```

Shapes: `rect` · `circle` · `diamond` · `cylinder`. Edge styles: `solid` · `dashed`. Limits: 40 nodes, 80 edges, 120-char labels.

### API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Always 200. Reports `available`, `provider`, `configured`, `model`, `hasKey` — never the key. |
| `POST` | `/api/ai/sketch-to-diagram` | Body `{ image, hint? }`. Returns `{ diagram, warnings, meta }`. |

`image` is a base64 PNG — either raw base64 (what the client sends) or a `data:image/png;base64,…` wrapper. The server decodes it and checks the PNG magic bytes, so arbitrary payloads never reach the model. The panel limits hints to 400 characters; the server independently truncates to `AI_MAX_HINT` (500 by default) and removes control characters.

Every error is `{ "error": { "kind": "...", "message": "..." } }`:

| `kind` | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 / 413 | Malformed body, not a PNG, or over the size budget |
| `rate_limited` | 429 | Per-IP limit or upstream model/provider rate limit; retry later or choose another route |
| `busy` | 503 | Global concurrency cap hit |
| `unavailable` | 503 | Missing/invalid credentials, insufficient provider credit, or an unsupported endpoint such as an agentic-harness-only model |
| `invalid_response` | 502 | The model's reply did not parse or validate |
| `upstream` | 502 | Any other provider failure |
| `timeout` | 504 | The model did not answer within `AI_TIMEOUT_MS` |
| `not_found` | 404 | Unknown `/api` route |
| `server` | 500 | Unexpected |

The client maps each to a human sentence, and the whiteboard stays fully usable through all of them.

---

## Project Layout

```
index.html                 Mirova title, favicon, lz-string, mount point
vite.config.js             React + single-file app build + secret guard
shared/
  diagramSchema.js         canonical semantic schema, validated on server and client
src/
  main.jsx  App.jsx        React shell, persistent theme, screenshot/format popups
  components/
    CanvasBoard.jsx        mounts the engine, zoom HUD and toast
    Toolbar.jsx            tools, palettes, widths, history, screenshot, AI, share
    AIPanel.jsx            hint, conversion state, preview, replace/add/discard
  engine/
    cicadaEngine.js        three-layer canvas, paste, shape prediction, renderer,
                           image/text/pen strokes, binary codec, undo/redo
  hooks/useCanvas.js       low-frequency React ↔ engine state bridge
  ai/
    layout.js              deterministic layered graph layout and edge routing
    toCicada.js            semantic graph → native editable strokes
  services/
    capture.js             board strokes/images → PNG via the engine renderer
    diagramClient.js       API fetch, errors, client-side schema validation
server/
  index.js                 Express app, CORS, health/API/static routes
  config.js                server/.env parsing, model and limits
  routes/ai.js             POST route and response envelope
  middleware/
    rateLimit.js           per-IP fixed window + global concurrency cap
    validateSketch.js      PNG/base64/size checks and hint sanitizing
  services/
    llmService.js          provider choice, JSON extraction, server validation
    prompt.js              whole-board and user-hint instructions
  providers/
    openrouter.js          OpenRouter standard Chat Completions adapter
    mock.js                deterministic diagram fixture for offline testing
tests/
  pipeline.test.js         offline pipeline, error, codec and palette regressions
src/assets/
  Absans-Regular.woff2     board text font
  cicada-mark.svg          Mirova browser-tab mark
```

The canvas engine stays imperative on purpose: high-frequency pointer work lives in refs and direct canvas calls, not React state. React renders the interface, not each pointer frame.

---

## 🛠️ The Tech Stack

- **Canvas:** HTML canvas layers, device-pixel-ratio scaling, pointer/touch input, pan/zoom, Ramer–Douglas–Peucker simplification, and shape prediction.
- **Image paste:** clipboard raster images up to 30 MB are downscaled and WebP-compressed to a maximum 750 KB data URL, rendered as image strokes, and embedded in the versioned share codec.
- **Binary codec:** varints and ZigZag coordinate deltas encode board strokes and viewport state into URL-safe Base64; newer versions also encode text formatting and images while decoding older versions.
- **Deterministic graph layout:** longest-path ranks, cycle handling, barycentre sweeps, viewport-aware orientation, and orthogonal edge routing.
- **Native rendering:** AI output becomes ordinary text, pen, circle, and path strokes, not a flattened diagram bitmap.
- **Fonts:** Geist is used for website UI; Absans is used for board text.
- **Runtime:** React 18 + Vite 5 + Express 4, with a provider adapter selected using `AI_PROVIDER` and `AI_MODEL`.
- **Production output:** Vite minifies and inlines the app JavaScript, CSS, and font into `dist/index.html`; the small hashed SVG favicon is emitted alongside it.

## Tests

Run `npm test` for the offline `node:test` suite. It covers mock mode without a key, semantic validation, the four graph examples, empty/unclear diagrams, missing keys, invalid model output, upstream rate limits and agentic-only model errors, legacy palette/codec compatibility, image share-link round-trips, and palette contrast. Tests stub upstream model responses; they do not make paid or live OpenRouter requests. The four realistic diagram examples have also been exercised manually against live vision models during development.

---

## ⚠️ `npm audit` Advisory

`npm audit` currently reports one moderate and one high advisory in **esbuild** and **vite**. They affect the development toolchain/dev server, not the app code emitted into the production bundle.

The project deliberately stays on **Vite 5**. `npm audit fix --force` would jump to a breaking major and risks `vite-plugin-singlefile` and the GitHub Pages workflow. If you want to clear the advisories, upgrade Vite in a dedicated PR and re-verify the single-file build — do not force-fix it as a side effect.

---

## 📜 License

This project is licensed under the [**MIT License**](LICENSE).

---

> 🍀 Stay light, stay fast, stay creative.

Built with ❤️ by Ansel.
