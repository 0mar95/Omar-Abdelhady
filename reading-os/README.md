# Kenning

A document-first desktop reader that turns hard-to-read PDFs into a clean,
comfortable book — with an AI reading companion that runs entirely on your
computer. No chat side panel: help appears inside the text, where you need it.

## Quick start (macOS or Windows)

1. Install [Node.js 22+](https://nodejs.org) and [Ollama](https://ollama.com).
2. Download the models (about 4.5 GB):

   ```sh
   ollama pull qwen3.5:4b            # explanations, margin notes, answers (reads text and images)
   ollama pull qwen3-embedding:0.6b  # search by meaning
   ```

   On a 16 GB Mac you can also pull `qwen3.5:9b` and pick it in
   **Reading settings → AI** for stronger answers (slower).
3. Install and run:

   ```sh
   cd reading-os
   npm install
   npm run dev
   ```

   The first `npm run dev` also downloads Electron itself (about 100 MB,
   one time only): Electron 45+ no longer fetches it during `npm install`.

4. Click **Open a book** (or drop a file on the window): PDF, EPUB, Word
   (.docx), HTML, Markdown or plain text. The first open of a PDF takes a few
   seconds (≈8 s for a 370-page textbook); other formats take well under a
   second; after that every book opens instantly from the cache.

Build an installer with `npm run dist:mac` or `npm run dist:win`.

## What you get

**Clean view** — the PDF rebuilt as a reflowable book:

- Real paragraphs: line-break hyphens, ligatures, two-column order, and
  sentences that continue across columns, pages and figures are repaired.
- Running headers, footers, page numbers, watermarks and stamped banners removed.
- Scrambled text repaired: PDFs whose fonts name glyphs in lower case
  ("u006b") or draw ligatures with private, unnamed glyphs read as normal
  text (each font's private glyphs are worked out from the book's own words).
- Headings and chapters detected, with a full table of contents (**T**); the
  book's own contents page becomes a clean list you can click to jump.
- Figures cropped from the original at high resolution (click to zoom).
- Tables rebuilt as real tables, merged across pages, with an **Original**
  toggle to see the printed version.
- Boxes and "Key Points" shown as callouts; reference lists collapsed.
- Hover a citation number to read the reference; hover "Fig 1-1",
  "Table 2-3" or "Box 4-2" to preview it; click to jump.
- The original page numbers sit quietly in the margin; click one to see that page.
- Themes (light, sepia, dark, black), five reading fonts, size, line spacing,
  line length, justification and book-style indents.

**Every book opens the same way** — a composed title page (cover, title,
subtitle, authors, edition, publisher), then one closed "About this book"
(copyright, adverts, dedication, contributors, acknowledgements), then
Kenning's own contents: chapters with their sections and reading times, no
page numbers. Chapters come from the PDF's bookmarks when it has them,
otherwise from the book's headings; the printed contents page only confirms
chapter numbers and authors. Blank pages are dropped; the foreword and
preface stay to be read.
Each chapter opens with its number, title, authors, reading time, its own key
points or objectives, and a clickable list of its sections.

**Figures and tables** — a figure sits right after the paragraph that first
mentions it. Click one to open it full screen: zoom with the wheel, a pinch,
double-click or + / −, and drag to pan. On a wide window the figure being
discussed stays in the left margin while you read about it. Tables keep their
header row in view as they scroll, and **Expand** opens them full screen.

**Quiet reading** — the bars fade away while you read and come back when you
scroll up or point at the top. **Focus mode** (F) dims everything but the
paragraph you are on. Select text and choose **Highlight** to mark it; page
numbers, highlights and AI notes share one margin column, and a slim rail at
the window's edge shows how far through the chapter you are.

**Other formats** — EPUB, Word (.docx), HTML, Markdown and plain text become
the same kind of book as a PDF, so everything below works on them too:
search, Ask, the glossary, margin notes and the inline AI. EPUB chapters follow
the book's own table of contents, and its images, tables and sidebars are kept;
Word headings, lists, tables and pictures come across; plain text has its
wrapped lines joined and "CHAPTER IV"-style headings found (Project
Gutenberg's license header and footer are left out). Copy-protected (DRM) books can't be opened, and images are
never fetched from the web.

**Inline AI** — select text and choose **Explain**, **Simplify**,
**Summarize**, **Key terms** or **Ask…**. The answer streams into a card right
under the paragraph. Cards can be collapsed, regenerated, copied or removed,
and are saved with the book.

**⌘K / Ctrl K — search and ask**

- Search this book or **all books** at once. Results combine exact words
  (with word variants: "neuralgias" finds "neuralgia") and meaning ("sleep
  problems in kids" finds the pediatric sleep apnea discussion); matches found
  only by meaning are marked *related*.
- Jump straight to sections, figures, tables and boxes by name.
- **Ask** a question: the answer is drawn from the book's passages and cites
  them ([1], [2]); click a citation or a source to jump there, or keep the
  answer on the page as a card.
- **Only what I've read** limits search and answers to the text before your
  position, so nothing ahead is spoiled.

**Glossary with hover definitions** — the app builds the book's glossary
from its own text: acronyms where they are spelled out ("temporomandibular
disorders (TMDs)") and terms the book defines ("*Nociplastic pain* is
defined as …"). The first mention of each term in a section gets a quiet
dotted underline; hover it to see:

- a one-sentence plain-language definition from the local model (written the
  first time you hover, then saved),
- the book's own defining sentence and its page,
- how many passages mention it, with a jump to the next mention,
- the same term in your other books.

Press **G** for the whole glossary A–Z (filterable); glossary entries also
appear at the top of ⌘K results. Underlines can be turned off in Reading
settings.

**Margin notes** — as you read, each section gets a one-line summary and its
key concepts in the right margin (under the heading on narrow windows). Notes
are written in the background for the section you're in and the next few,
and saved; click a concept to search the book for it. Turn them off in
Reading settings or from ⌘K.

**Catch me up** — reopen a book after a few hours away and a recap greets
you where you stopped: what you read most recently, the sections just before
it, and a **Continue reading** button. Switch between **Where I left off**,
**This chapter** and **Book so far**. Recaps are written only from the text
before your position (nothing ahead is spoiled), use the margin notes already
written for earlier sections, and are saved, so reopening at the same place is
instant. Press **R** or use ⌘K any time; turn the automatic recap off in
Reading settings.

Everything stays on your machine: books are read from disk, the extracted book
is cached locally, and the AI only talks to Ollama on `localhost`.

### Keyboard

| Key | Action |
| --- | --- |
| ⌘K / Ctrl K | Search, jump, commands, ask |
| T | Table of contents |
| G | Glossary (A–Z) |
| F | Focus mode on / off |
| R | Catch me up (recap of what you've read) |
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

## Search index and margin notes

`src/main/library.ts` keeps a local index in `library.sqlite` (in the app's data
folder), using the SQLite built into Electron — no extra native modules:

- **Chunks:** paragraphs are grouped into ~220-word passages within a section;
  figures, tables and boxes are chunks of their own; reference lists are
  searchable by exact words only.
- **Exact words:** an FTS5 table with Porter stemming, ranked with BM25.
- **Meaning:** each chunk is embedded with `qwen3-embedding:0.6b` in the
  background (open book first). Vectors are stored in SQLite and compared by
  brute-force cosine similarity — about 10 ms per book, ~140 ms across a
  50-book library. A dedicated vector engine (LanceDB) would add ~200 MB to
  the app for no gain at this size; the store is isolated in one class so it
  can be swapped in for very large libraries.
- **Hybrid ranking:** both result lists are merged with Reciprocal Rank Fusion.
- **Margin notes:** the section you're reading comes first, then the next few
  ahead; each note is one structured-JSON request to the chat model.
- **Background work stays out of the way:** it pauses while you're waiting on
  an answer and while you scroll (on Apple silicon the models share the GPU
  with the window, so running them mid-scroll makes scrolling stutter), and
  embeds in small batches.
- **New extractor versions** re-read a book once, but keep the vectors of
  unchanged passages and the margin notes of unchanged headings. Block ids are
  per page (`p12-3`), so a change on one page doesn't move the rest.
- **Glossary:** terms are extracted without AI (`src/shared/glossary/`:
  Schwartz–Hearst for acronyms, italic terms in defining sentences, plural and
  proper-name handling). A hovered term's short definition jumps to the front
  of the background queue; other-book mentions are a phrase query on the
  full-text index.

Without the embedding model, exact-word search still works; without Ollama,
everything except AI features works.

Try the extractor on any PDF without the app:

```sh
npm run extract -- path/to/book.pdf   # or .epub, .docx, .md, .txt; writes .extract/book.json and preview.html
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
   │  ├─ library.ts            search index (FTS5 + vectors), margin notes
   │  └─ ollama.ts             local-only Ollama client: chat, JSON, embeddings
   ├─ preload/index.ts         the small, typed bridge (window.readingOS)
   ├─ shared/
   │  ├─ model.ts              the book format (blocks, chapters, TOC)
   │  ├─ recap.ts              what a "catch me up" recap is written from
   │  ├─ ipc.ts                main ↔ renderer contract
   │  ├─ pdf/                  the extraction pipeline (+ tests)
   │  ├─ formats/              EPUB, Word, HTML, Markdown and text → the same book format
   │  ├─ glossary/extract.ts   glossary terms, definitions, mention matching
   │  └─ search/chunks.ts      chunking, note sections, query building, fusion
   └─ renderer/src/
      ├─ App.tsx, platform.ts  app shell; Electron vs browser services
      ├─ pdf.ts                pdf.js setup, caching, region rendering
      ├─ ai.ts                 prompts, reading context, inline cards
      ├─ search.ts             search and Ask (retrieval + cited answers)
      ├─ state/                settings, library, open book, notes, glossary
      ├─ library/              library screen
      ├─ command/              ⌘K palette
      └─ reader/               clean view, blocks, selection menu,
                               inline cards, margin notes, hover cards (citations,
                               figures, glossary terms), glossary sheet, overlays
```

## Development

```sh
npm run dev         # desktop app with hot reload
npm run web         # the UI in a browser at http://localhost:5199 (add ?mockAI to fake AI answers)
npm test            # unit tests; BOOK_PDF=/path/book.pdf npm test also runs the full-book test
npm run typecheck
```

## Roadmap

- Done: reflowed reader, inline AI, hybrid search across the library, cited
  answers with a reading-position limit, margin notes, glossary with hover
  definitions and cross-book mentions; EPUB, Word, HTML, Markdown and text;
  "catch me up" recaps.
- Next: figure descriptions with a vision model, so figures are searchable.
- OCR for scanned PDFs (`glm-ocr`), and older Kindle files (MOBI/AZW3).

Books you open are never committed to this repository (`*.pdf` is ignored).
