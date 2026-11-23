# Reading OS

A document-first desktop reader that turns hard-to-read PDFs into a clean,
comfortable book — with an AI reading companion that runs entirely on your
computer. No chat side panel: help appears inside the text, where you need it.

## Quick start (macOS or Windows)

1. Install [Node.js 22+](https://nodejs.org) and [Ollama](https://ollama.com).
2. Download the models (about 4.5 GB):

   ```sh
   ollama pull qwen3.5:4b            # explanations, summaries, questions (reads text and images)
   ollama pull qwen3-embedding:0.6b  # optional for now: semantic search arrives in the next phase
   ```

   On a 16 GB Mac you can also pull `qwen3.5:9b` and pick it in
   **Reading settings → AI** for stronger answers (slower).
3. Install and run:

   ```sh
   cd reading-os
   npm install
   npm run dev
   ```

4. Click **Open PDF** (or drop a PDF on the window). The first open of a book
   takes a few seconds (≈8 s for a 370-page textbook); after that it opens
   instantly from the cache.

Build an installer with `npm run dist:mac` or `npm run dist:win`.

## What you get

**Clean view** — the PDF rebuilt as a reflowable book:

- Real paragraphs: line-break hyphens, ligatures, two-column order, and
  sentences that continue across columns, pages and figures are repaired.
- Running headers, footers, page numbers, watermarks and stamped banners removed.
- Headings and chapters detected, with a full table of contents (**T**).
- Figures cropped from the original at high resolution (click to zoom).
- Tables rebuilt as real tables, merged across pages, with an **Original**
  toggle to see the printed version.
- Boxes and "Key Points" shown as callouts; reference lists collapsed.
- Hover a citation number to read the reference; hover "Fig 1-1",
  "Table 2-3" or "Box 4-2" to preview it; click to jump.
- The original page numbers sit quietly in the margin; click one to see that page.
- Themes (light, sepia, dark, black), five reading fonts, size, line spacing,
  line length, justification and book-style indents.

**Page view** — the original pages, with selectable text (**V** to toggle;
your place is kept).

**Inline AI** — select text and choose **Explain**, **Simplify**,
**Summarize**, **Key terms** or **Ask…**. The answer streams into a card right
under the paragraph. Cards can be collapsed, regenerated, copied or removed,
and are saved with the book.

**⌘K / Ctrl K** — search the whole book, jump to sections, figures, tables and
boxes, run commands, or *ask about what you're reading*: the answer appears at
your position and uses only text up to there, so it never spoils what's ahead.

Everything stays on your machine: books are read from disk, the extracted book
is cached locally, and the AI only talks to Ollama on `localhost`.

### Keyboard

| Key | Action |
| --- | --- |
| ⌘K / Ctrl K | Search, jump, commands, ask |
| T | Table of contents |
| V | Clean view ↔ original pages |
| [ / ] | Previous / next chapter |
| ⌘+ / ⌘− | Text size |
| ⌘O | Open a PDF |
| Esc | Close overlays and menus |

## How the PDF becomes a book

`src/shared/pdf/` is a pure TypeScript pipeline over pdf.js (it runs in the
app and in Node, so it can be tested on its own):

1. **load** — text runs with real font names, and the rectangles of drawings
   and images (following transforms, clips, transparency and form objects).
2. **lines** — runs → lines; drops rotated, tiny and repeated text (footers,
   watermarks); attaches superscript citations, subscripts, bullets and drop caps.
3. **layout** — detects columns from body text, splits merged columns, removes
   running headers/footers, reads printed page numbers, orders everything.
4. **regions** — captions anchor figures (nearest drawing), tables and boxes
   (shaded background or a change of font).
5. **blocks** — paragraphs across breaks, heading levels from the book's own
   styles, lists, key points, reference lists, footnotes, index.
6. **analyze** — chapters, page labels, links for "Fig 1-1" and "page 138",
   table of contents.

Try it on any PDF without the app:

```sh
npm run extract -- path/to/book.pdf   # writes .extract/book.json and preview.html
```

## Project layout

```
reading-os/
├─ electron.vite.config.ts     desktop build (main, preload, renderer)
├─ vite.web.config.ts          browser build of the UI, for development and tests
├─ scripts/
│  ├─ extract.ts               command-line extractor
│  └─ copy-pdfjs-assets.mjs    bundles pdf.js fonts/decoders for offline use
└─ src/
   ├─ main/                    Electron main process
   │  ├─ index.ts              window, app:// protocol, files, cache, menus
   │  └─ ollama.ts             local-only Ollama client, streams over IPC
   ├─ preload/index.ts         the small, typed bridge (window.readingOS)
   ├─ shared/
   │  ├─ model.ts              the book format (blocks, chapters, TOC)
   │  ├─ ipc.ts                main ↔ renderer contract
   │  └─ pdf/                  the extraction pipeline (+ tests)
   └─ renderer/src/
      ├─ App.tsx, platform.ts  app shell; Electron vs browser services
      ├─ pdf.ts                pdf.js setup, caching, region rendering
      ├─ ai.ts                 prompts, reading context, inline cards
      ├─ state/                settings, library, open book
      ├─ library/              library screen
      ├─ command/              ⌘K palette
      └─ reader/               clean view, page view, blocks, selection
                               menu, inline cards, hover cards, overlays
```

## Development

```sh
npm run dev         # desktop app with hot reload
npm run web         # the UI in a browser at http://localhost:5199 (add ?mockAI to fake AI answers)
npm test            # unit tests; BOOK_PDF=/path/book.pdf npm test also runs the full-book test
npm run typecheck
```

## Roadmap

- **Next:** SQLite + full-text index and local embeddings (LanceDB) for hybrid
  search and whole-book Q&A with citations.
- Margin notes (section summaries and key concepts), section recaps,
  "catch me up" and an automatic glossary with hover definitions.
- Figure descriptions with a vision model, so figures are searchable.
- OCR for scanned PDFs (`glm-ocr`), then EPUB, Markdown, TXT and MOBI.

Books you open are never committed to this repository (`*.pdf` is ignored).
