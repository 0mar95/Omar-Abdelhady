// The local library index: search chunks in SQLite (FTS5 for exact words,
// stored embeddings for meaning), hybrid ranking, and margin notes generated
// in the background around the reader's position. No Electron imports, so it
// can be tested on its own.

import { DatabaseSync } from "node:sqlite";
import type { AiConfig, BookMention, DefineRequest, GlossaryEvent, IndexStatus, MarginNote, NoteEvent, SearchHit, SearchParams } from "../shared/ipc.ts";
import { EXTRACTOR_VERSION, type BookDoc } from "../shared/model.ts";
import { buildChunks, embedPrefix, embedText, ftsQuery, fuse, noteSections, type NoteSection, type Ranked } from "../shared/search/chunks.ts";

/** Bump when chunking changes so books are re-indexed. */
const CHUNKER_VERSION = 1;
const INDEX_VERSION = EXTRACTOR_VERSION * 100 + CHUNKER_VERSION;
const EMBED_BATCH = 24;
/** Notes are prepared this many sections behind and ahead of the reader. */
const NOTES_BEHIND = 1;
const NOTES_AHEAD = 6;

export interface NoteDraft {
  summary: string;
  concepts: string[];
}

export interface LibraryDeps {
  loadBook(bookId: string): Promise<BookDoc | null>;
  embed(cfg: AiConfig, texts: string[]): Promise<Float32Array[]>;
  writeNote(cfg: AiConfig, book: BookDoc, section: NoteSection): Promise<NoteDraft>;
  writeDefinition(cfg: AiConfig, bookTitle: string, req: DefineRequest): Promise<{ definition: string }>;
  emitGlossary(e: GlossaryEvent): void;
  userBusy(): boolean;
  emitStatus(s: IndexStatus): void;
  emitNote(e: NoteEvent): void;
  /** Error classes thrown by embed/writeNote. */
  isModelMissing(e: unknown): boolean;
  isOffline(e: unknown): boolean;
}

interface VectorSet {
  model: string;
  dim: number;
  ids: Int32Array;
  blockIndex: Int32Array;
  bookIdx: Int32Array;
  books: string[];
  data: Float32Array;
}

interface ChunkRow {
  id: number;
  book_id: string;
  block_id: string;
  block_index: number;
  chapter: number;
  section: string;
  page: number;
  kind: string;
  text: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LibraryIndex {
  private db: DatabaseSync;
  private deps: LibraryDeps;
  private cfg: AiConfig = { baseUrl: "http://127.0.0.1:11434", chatModel: "qwen3.5:4b", embedModel: "qwen3-embedding:0.6b", notes: true };
  private embedState: "ok" | "no-embed-model" | "offline" = "ok";
  private notesState: "ok" | "no-model" | "offline" = "ok";
  private vectors: VectorSet | null = null;
  private active: { bookId: string; blockIndex: number } | null = null;
  private books = new Map<string, { doc: BookDoc; sections: NoteSection[] }>();
  private working = false;
  private failedNotes = new Set<string>();
  /** Definitions the reader asked for (hovered terms), most recent first. */
  private defineQueue: { bookId: string; req: DefineRequest }[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(file: string, deps: LibraryDeps) {
    this.db = new DatabaseSync(file);
    this.deps = deps;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT, version INTEGER, chunks INTEGER, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY, book_id TEXT NOT NULL, seq INTEGER, block_id TEXT, block_index INTEGER, block_end INTEGER,
        chapter INTEGER, section TEXT, page INTEGER, kind TEXT, text TEXT);
      CREATE INDEX IF NOT EXISTS chunks_book ON chunks(book_id, seq);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, section, tokenize = 'porter unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS vectors (chunk_id INTEGER PRIMARY KEY, model TEXT NOT NULL, vec BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (book_id TEXT, block_id TEXT, model TEXT, summary TEXT, concepts TEXT, created_at INTEGER,
        PRIMARY KEY (book_id, block_id));
      CREATE TABLE IF NOT EXISTS glossary (book_id TEXT, key TEXT, term TEXT, definition TEXT, model TEXT, created_at INTEGER,
        PRIMARY KEY (book_id, key));
    `);
  }

  close(): void {
    clearTimeout(this.retryTimer);
    this.db.close();
  }

  configure(cfg: AiConfig): void {
    const embedChanged = cfg.embedModel !== this.cfg.embedModel;
    this.cfg = { ...cfg };
    this.embedState = "ok";
    this.notesState = "ok";
    this.failedNotes.clear();
    if (embedChanged) this.vectors = null;
    this.kick();
  }

  // ---------- indexing ----------

  /** Makes sure a book is chunked and in the full-text index; embedding continues in the background. */
  async indexBook(bookId: string, title: string, blockIndex = 0): Promise<IndexStatus> {
    const doc = await this.deps.loadBook(bookId);
    if (!doc) return this.status(bookId);
    this.books.set(bookId, { doc, sections: noteSections(doc) });
    const row = this.db.prepare("SELECT version FROM books WHERE id = ?").get(bookId) as { version: number } | undefined;
    if (!row || row.version !== INDEX_VERSION) this.rebuild(bookId, title || doc.title, doc);
    else this.db.prepare("UPDATE books SET title = ? WHERE id = ?").run(title || doc.title, bookId);
    this.active = { bookId, blockIndex };
    if (this.embedState !== "ok" || this.notesState !== "ok") {
      // A new open is a good moment to retry a model that was missing or offline.
      this.embedState = "ok";
      this.notesState = "ok";
    }
    this.kick();
    return this.status(bookId);
  }

  private rebuild(bookId: string, title: string, doc: BookDoc): void {
    const chunks = buildChunks(doc);
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE book_id = ?)").run(bookId);
      this.db.prepare("DELETE FROM vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE book_id = ?)").run(bookId);
      this.db.prepare("DELETE FROM chunks WHERE book_id = ?").run(bookId);
      // Block ids can change with a new extraction, so old notes go too.
      this.db.prepare("DELETE FROM notes WHERE book_id = ?").run(bookId);
      const ins = this.db.prepare(
        "INSERT INTO chunks (book_id, seq, block_id, block_index, block_end, chapter, section, page, kind, text) VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      const fts = this.db.prepare("INSERT INTO chunks_fts (rowid, text, section) VALUES (?, ?, ?)");
      for (const c of chunks) {
        const r = ins.run(bookId, c.seq, c.blockId, c.blockIndex, c.blockEnd, c.chapter, c.section, c.page, c.kind, c.text);
        fts.run(Number(r.lastInsertRowid), c.text, c.section);
      }
      this.db
        .prepare("INSERT INTO books (id, title, version, chunks, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, version=excluded.version, chunks=excluded.chunks, updated_at=excluded.updated_at")
        .run(bookId, title, INDEX_VERSION, chunks.length, Date.now());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.vectors = null;
  }

  status(bookId: string): IndexStatus {
    const chunks = (this.db.prepare("SELECT COUNT(*) n FROM chunks WHERE book_id = ? AND kind != 'refs'").get(bookId) as { n: number }).n;
    const embedded = (
      this.db
        .prepare("SELECT COUNT(*) n FROM vectors v JOIN chunks c ON c.id = v.chunk_id WHERE c.book_id = ? AND v.model = ?")
        .get(bookId, this.cfg.embedModel) as { n: number }
    ).n;
    const notes = (this.db.prepare("SELECT COUNT(*) n FROM notes WHERE book_id = ?").get(bookId) as { n: number }).n;
    const state: IndexStatus["state"] =
      chunks === 0
        ? "unknown"
        : this.embedState === "no-embed-model"
          ? "no-embed-model"
          : this.embedState === "offline"
            ? "offline"
            : embedded < chunks
              ? "embedding"
              : "ready";
    return { bookId, state, chunks, embedded, embedModel: this.cfg.embedModel, notes };
  }

  setPosition(bookId: string, blockIndex: number): void {
    this.active = { bookId, blockIndex };
    this.kick();
  }

  // ---------- background work ----------

  private kick(): void {
    if (!this.working) void this.work();
  }

  private async work(): Promise<void> {
    this.working = true;
    try {
      for (;;) {
        if (this.deps.userBusy()) {
          await sleep(300);
          continue;
        }
        const job = this.nextJob();
        if (!job) break;
        await job();
      }
    } finally {
      this.working = false;
    }
  }

  private nextJob(): (() => Promise<void>) | null {
    // A hovered term is waiting on screen: it goes first.
    if (this.defineQueue.length && this.notesState === "ok") {
      const job = this.defineQueue.shift()!;
      return () => this.define(job.bookId, job.req);
    }
    if (this.defineQueue.length) {
      for (const j of this.defineQueue.splice(0)) this.deps.emitGlossary({ bookId: j.bookId, key: j.req.key, failed: true });
    }
    const near = this.pendingNote(NOTES_BEHIND, 2);
    if (near) return () => this.makeNote(near.bookId, near.section);
    const batch = this.embedState === "ok" ? this.pendingEmbeds() : null;
    if (batch) return () => this.embedBatch(batch);
    const far = this.pendingNote(NOTES_BEHIND, NOTES_AHEAD);
    if (far) return () => this.makeNote(far.bookId, far.section);
    return null;
  }

  private pendingEmbeds(): { bookId: string; rows: { id: number; section: string; text: string }[] } | null {
    // The open book first, then any other book that still needs vectors.
    const order = this.active ? [this.active.bookId] : [];
    for (const r of this.db.prepare("SELECT id FROM books").all() as { id: string }[]) if (!order.includes(r.id)) order.push(r.id);
    for (const bookId of order) {
      const rows = this.db
        .prepare(
          `SELECT c.id, c.section, c.text FROM chunks c LEFT JOIN vectors v ON v.chunk_id = c.id AND v.model = ?
           WHERE c.book_id = ? AND c.kind != 'refs' AND v.chunk_id IS NULL ORDER BY c.seq LIMIT ?`,
        )
        .all(this.cfg.embedModel, bookId, EMBED_BATCH) as { id: number; section: string; text: string }[];
      if (rows.length) return { bookId, rows };
    }
    return null;
  }

  private async embedBatch(batch: { bookId: string; rows: { id: number; section: string; text: string }[] }): Promise<void> {
    const model = this.cfg.embedModel;
    const prefix = embedPrefix(model, "document");
    try {
      const vecs = await this.deps.embed(
        this.cfg,
        batch.rows.map((r) => prefix + embedText(r)),
      );
      const ins = this.db.prepare("INSERT OR REPLACE INTO vectors (chunk_id, model, vec) VALUES (?, ?, ?)");
      this.db.exec("BEGIN");
      batch.rows.forEach((r, i) => {
        const v = vecs[i];
        if (v) ins.run(r.id, model, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      });
      this.db.exec("COMMIT");
      this.vectors = null;
    } catch (e) {
      if (this.deps.isModelMissing(e)) this.embedState = "no-embed-model";
      else if (this.deps.isOffline(e)) this.offline("embed");
      else {
        console.error("embedding failed", e);
        this.embedState = "offline";
      }
    }
    this.deps.emitStatus(this.status(batch.bookId));
  }

  private offline(what: "embed" | "notes"): void {
    if (what === "embed") this.embedState = "offline";
    else this.notesState = "offline";
    // Try again later in case Ollama gets started.
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.embedState = this.embedState === "offline" ? "ok" : this.embedState;
      this.notesState = this.notesState === "offline" ? "ok" : this.notesState;
      this.kick();
    }, 90_000);
  }

  private pendingNote(behind: number, ahead: number): { bookId: string; section: NoteSection } | null {
    if (!this.cfg.notes || this.notesState !== "ok" || !this.active) return null;
    const book = this.books.get(this.active.bookId);
    if (!book || !book.sections.length) return null;
    const pos = this.active.blockIndex;
    // The section the reader is in (the last one starting at or before the position).
    let cur = 0;
    book.sections.forEach((s, i) => {
      if (s.blockIndex <= pos) cur = i;
    });
    const have = new Set(
      (this.db.prepare("SELECT block_id FROM notes WHERE book_id = ?").all(this.active.bookId) as { block_id: string }[]).map((r) => r.block_id),
    );
    const order: number[] = [cur];
    for (let d = 1; d <= Math.max(behind, ahead); d++) {
      if (d <= ahead) order.push(cur + d);
      if (d <= behind) order.push(cur - d);
    }
    for (const i of order) {
      const s = book.sections[i];
      if (s && !have.has(s.blockId) && !this.failedNotes.has(`${this.active.bookId}:${s.blockId}`)) return { bookId: this.active.bookId, section: s };
    }
    return null;
  }

  private async makeNote(bookId: string, section: NoteSection): Promise<void> {
    const book = this.books.get(bookId);
    if (!book) return;
    this.deps.emitNote({ type: "working", bookId, blockId: section.blockId });
    try {
      const draft = await this.deps.writeNote(this.cfg, book.doc, section);
      const note: MarginNote = {
        bookId,
        blockId: section.blockId,
        summary: cleanSummary(draft.summary),
        concepts: cleanConcepts(draft.concepts),
        model: this.cfg.chatModel,
        createdAt: Date.now(),
      };
      if (!note.summary) throw new Error("empty note");
      this.db
        .prepare("INSERT OR REPLACE INTO notes (book_id, block_id, model, summary, concepts, created_at) VALUES (?,?,?,?,?,?)")
        .run(bookId, note.blockId, note.model, note.summary, JSON.stringify(note.concepts), note.createdAt);
      this.deps.emitNote({ type: "note", note });
    } catch (e) {
      if (this.deps.isModelMissing(e)) this.notesState = "no-model";
      else if (this.deps.isOffline(e)) this.offline("notes");
      else this.failedNotes.add(`${bookId}:${section.blockId}`);
    } finally {
      this.deps.emitNote({ type: "working", bookId, blockId: null });
    }
    this.deps.emitStatus(this.status(bookId));
  }

  // ---------- glossary ----------

  definitions(bookId: string): Record<string, string> {
    const rows = this.db.prepare("SELECT key, definition FROM glossary WHERE book_id = ?").all(bookId) as { key: string; definition: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.definition]));
  }

  /** A stored definition, or null after queueing one (delivered through emitGlossary). */
  requestDefinition(bookId: string, req: DefineRequest): string | null {
    const row = this.db.prepare("SELECT definition FROM glossary WHERE book_id = ? AND key = ?").get(bookId, req.key) as { definition: string } | undefined;
    if (row) return row.definition;
    this.defineQueue = [{ bookId, req }, ...this.defineQueue.filter((j) => !(j.bookId === bookId && j.req.key === req.key))].slice(0, 12);
    this.kick();
    return null;
  }

  private async define(bookId: string, req: DefineRequest): Promise<void> {
    const title = (this.db.prepare("SELECT title FROM books WHERE id = ?").get(bookId) as { title: string } | undefined)?.title ?? "";
    try {
      const out = await this.deps.writeDefinition(this.cfg, title, req);
      const definition = String(out?.definition ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
      if (!definition) throw new Error("empty definition");
      this.db
        .prepare("INSERT OR REPLACE INTO glossary (book_id, key, term, definition, model, created_at) VALUES (?,?,?,?,?,?)")
        .run(bookId, req.key, req.term, definition, this.cfg.chatModel, Date.now());
      this.deps.emitGlossary({ bookId, key: req.key, definition });
    } catch (e) {
      if (this.deps.isModelMissing(e)) this.notesState = "no-model";
      else if (this.deps.isOffline(e)) this.offline("notes");
      this.deps.emitGlossary({ bookId, key: req.key, failed: true });
    }
  }

  /** Where a term appears in other books (exact words, with word variants). */
  mentions(phrases: string[], excludeBookId: string): BookMention[] {
    const terms = [...new Set(phrases.map((p) => p.replace(/["*^:()]/g, " ").trim()).filter((p) => p.length > 1))].slice(0, 6);
    if (!terms.length) return [];
    const q = terms.map((t) => `"${t}"`).join(" OR ");
    const rows = safe(
      () =>
        this.db
          .prepare(
            `SELECT c.book_id AS bookId, COUNT(*) AS count, MIN(c.block_index) AS first FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
             WHERE chunks_fts MATCH ? AND c.book_id != ? AND c.kind != 'refs' GROUP BY c.book_id ORDER BY count DESC LIMIT 6`,
          )
          .all(q, excludeBookId) as { bookId: string; count: number; first: number }[],
    );
    return rows.map((r) => {
      const at = this.db.prepare("SELECT block_id FROM chunks WHERE book_id = ? AND block_index = ? LIMIT 1").get(r.bookId, r.first) as { block_id: string } | undefined;
      const title = (this.db.prepare("SELECT title FROM books WHERE id = ?").get(r.bookId) as { title: string } | undefined)?.title ?? "";
      return { bookId: r.bookId, title, count: r.count, blockId: at?.block_id ?? "" };
    });
  }

  /** Resolves once background work has nothing left to do (used by tests). */
  async whenIdle(): Promise<void> {
    while (this.working) await sleep(20);
  }

  notes(bookId: string): MarginNote[] {
    return (
      this.db.prepare("SELECT book_id, block_id, model, summary, concepts, created_at FROM notes WHERE book_id = ?").all(bookId) as {
        book_id: string;
        block_id: string;
        model: string;
        summary: string;
        concepts: string;
        created_at: number;
      }[]
    ).map((r) => ({ bookId: r.book_id, blockId: r.block_id, model: r.model, summary: r.summary, concepts: JSON.parse(r.concepts), createdAt: r.created_at }));
  }

  // ---------- search ----------

  async search(p: SearchParams): Promise<SearchHit[]> {
    const limit = p.limit ?? 20;
    const fts = this.ftsSearch(p, 60);
    let vec: { id: number; sim: number }[] = [];
    if (this.embedState === "ok" && p.q.trim().length > 2 && this.hasVectors(p.bookId)) {
      try {
        const [qv] = await Promise.race([
          this.deps.embed(this.cfg, [embedPrefix(this.cfg.embedModel, "query") + p.q.trim()]),
          sleep(4000).then(() => {
            throw new Error("embedding timed out");
          }),
        ]);
        if (qv) vec = this.vectorSearch(qv, p, 60);
      } catch {
        /* exact-word results still work without the embedding model */
      }
    }
    const lists: Ranked[][] = [fts.map((h, i) => ({ key: h.id, rank: i })), vec.map((h, i) => ({ key: h.id, rank: i }))];
    const scores = fuse(lists);
    const exact = new Map(fts.map((h) => [h.id, h.snippet]));
    const meaning = new Set(vec.map((h) => h.id));
    const ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!ids.length) return [];
    const rows = this.db
      .prepare(
        `SELECT c.id, c.book_id, c.block_id, c.block_index, c.chapter, c.section, c.page, c.kind, c.text FROM chunks c WHERE c.id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids.map(([id]) => id)) as unknown as ChunkRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const titles = new Map((this.db.prepare("SELECT id, title FROM books").all() as { id: string; title: string }[]).map((r) => [r.id, r.title]));
    const hits: SearchHit[] = [];
    for (const [id, score] of ids) {
      const r = byId.get(id);
      if (!r) continue;
      const inExact = exact.has(id);
      hits.push({
        bookId: r.book_id,
        bookTitle: titles.get(r.book_id) ?? "",
        chunkId: id,
        blockId: r.block_id,
        blockIndex: r.block_index,
        chapter: r.chapter,
        section: r.section,
        page: r.page,
        kind: r.kind,
        snippet: inExact ? exact.get(id)! : bestSentence(r.text, p.q),
        text: r.text,
        match: inExact && meaning.has(id) ? "both" : inExact ? "exact" : "meaning",
        score,
      });
    }
    return hits;
  }

  private ftsSearch(p: SearchParams, n: number): { id: number; snippet: string }[] {
    const run = (q: string) =>
      this.db
        .prepare(
          `SELECT f.rowid AS id, snippet(chunks_fts, 0, char(1), char(2), '…', 16) AS snippet
           FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
           WHERE chunks_fts MATCH ?1 AND (?2 IS NULL OR c.book_id = ?2) AND (?3 IS NULL OR c.block_index <= ?3)
           ORDER BY bm25(chunks_fts, 1.0, 0.4) LIMIT ?4`,
        )
        .all(q, p.bookId ?? null, p.maxBlock ?? null, n) as { id: number; snippet: string }[];
    const and = ftsQuery(p.q, "and");
    if (!and) return [];
    let hits = safe(() => run(and));
    if (hits.length < 5) {
      const or = ftsQuery(p.q, "or");
      if (or && or !== and) {
        const seen = new Set(hits.map((h) => h.id));
        hits = hits.concat(safe(() => run(or)).filter((h) => !seen.has(h.id)));
      }
    }
    // Reference lists mention every topic in their titles; the book's own text
    // comes first. (An author's name still finds the references.)
    if (!hits.length) return hits;
    const kinds = new Map(
      (this.db.prepare(`SELECT id, kind FROM chunks WHERE id IN (${hits.map(() => "?").join(",")})`).all(...hits.map((h) => h.id)) as { id: number; kind: string }[]).map(
        (r) => [r.id, r.kind],
      ),
    );
    return [...hits.filter((h) => kinds.get(h.id) !== "refs"), ...hits.filter((h) => kinds.get(h.id) === "refs")];
  }

  private hasVectors(bookId?: string): boolean {
    const set = this.loadVectors();
    if (!set || set.ids.length === 0) return false;
    return !bookId || set.books.includes(bookId);
  }

  private loadVectors(): VectorSet | null {
    if (this.vectors && this.vectors.model === this.cfg.embedModel) return this.vectors;
    const rows = this.db
      .prepare("SELECT v.chunk_id, v.vec, c.block_index, c.book_id FROM vectors v JOIN chunks c ON c.id = v.chunk_id WHERE v.model = ?")
      .all(this.cfg.embedModel) as { chunk_id: number; vec: Uint8Array; block_index: number; book_id: string }[];
    if (!rows.length) return (this.vectors = { model: this.cfg.embedModel, dim: 0, ids: new Int32Array(), blockIndex: new Int32Array(), bookIdx: new Int32Array(), books: [], data: new Float32Array() });
    const dim = rows[0].vec.byteLength / 4;
    const data = new Float32Array(rows.length * dim);
    const ids = new Int32Array(rows.length);
    const blockIndex = new Int32Array(rows.length);
    const bookIdx = new Int32Array(rows.length);
    const books: string[] = [];
    rows.forEach((r, i) => {
      const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength));
      if (v.length === dim) data.set(v, i * dim);
      ids[i] = r.chunk_id;
      blockIndex[i] = r.block_index;
      let b = books.indexOf(r.book_id);
      if (b < 0) b = books.push(r.book_id) - 1;
      bookIdx[i] = b;
    });
    return (this.vectors = { model: this.cfg.embedModel, dim, ids, blockIndex, bookIdx, books, data });
  }

  /** Brute-force cosine similarity (vectors are unit length): fast for a personal library. */
  private vectorSearch(q: Float32Array, p: SearchParams, n: number): { id: number; sim: number }[] {
    const set = this.loadVectors();
    if (!set || !set.dim || q.length !== set.dim) return [];
    const bookFilter = p.bookId ? set.books.indexOf(p.bookId) : -1;
    if (p.bookId && bookFilter < 0) return [];
    const top: { id: number; sim: number }[] = [];
    let floor = -Infinity;
    for (let i = 0; i < set.ids.length; i++) {
      if (bookFilter >= 0 && set.bookIdx[i] !== bookFilter) continue;
      if (p.maxBlock !== undefined && set.blockIndex[i] > p.maxBlock) continue;
      let s = 0;
      const o = i * set.dim;
      for (let k = 0; k < set.dim; k++) s += set.data[o + k] * q[k];
      if (top.length < n || s > floor) {
        top.push({ id: set.ids[i], sim: s });
        if (top.length > n) {
          top.sort((a, b) => b.sim - a.sim);
          top.length = n;
          floor = top[top.length - 1].sim;
        }
      }
    }
    top.sort((a, b) => b.sim - a.sim);
    // Keep results reasonably close to the best match.
    const best = top[0]?.sim ?? 0;
    return top.filter((t) => t.sim >= Math.max(0.2, best - 0.22));
  }
}

function safe<T>(f: () => T[]): T[] {
  try {
    return f();
  } catch {
    return [];
  }
}

const STOP = new Set("the a an of and or to in on for with is are was were be by as at from that this which what how why does do it its into about".split(" "));

/** The sentence that best matches the query, with matching words marked. */
export function bestSentence(text: string, q: string): string {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => t.slice(0, 5));
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  let best = sentences[0] ?? "";
  let bestScore = -1;
  for (const s of sentences) {
    const words = s.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    const score = terms.filter((t) => words.some((w) => w.startsWith(t))).length;
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  let out = best.trim();
  if (out.length > 260) out = `${out.slice(0, 260)}…`;
  if (!terms.length) return out;
  return out.replace(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu, (w) => (terms.some((t) => w.toLowerCase().startsWith(t)) ? `\u0001${w}\u0002` : w));
}

function cleanSummary(s: string): string {
  return (s ?? "")
    .replace(/^\s*(this|the) section (discusses|describes|explains|covers|introduces)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
    .slice(0, 220);
}

function cleanConcepts(cs: string[]): string[] {
  const out: string[] = [];
  for (const c of Array.isArray(cs) ? cs : []) {
    const t = String(c).replace(/\s+/g, " ").trim().replace(/[.;:]$/, "");
    if (t && t.length <= 48 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 4);
}

// ---------- prompts ----------

export const NOTE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    concepts: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "concepts"],
};

export function noteMessages(book: BookDoc, s: NoteSection): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content:
        "You write margin notes for someone reading a book. Notes are terse, factual and drawn only from the section text given. Answer in JSON.",
    },
    {
      role: "user",
      content: `Book: ${book.title}
Section: ${s.path}

"""${s.text.slice(0, 9000)}"""

Return JSON with:
- "summary": one sentence of at most 22 words stating the section's main point. Do not start with "This section".
- "concepts": the 2 to 4 most important terms or ideas, each 1 to 4 words, using the book's own wording.`,
    },
  ];
}

export const DEFINITION_SCHEMA = {
  type: "object",
  properties: { definition: { type: "string" } },
  required: ["definition"],
};

export function definitionMessages(bookTitle: string, r: DefineRequest): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: "You write glossary entries for someone reading a book. Define terms in plain language, using only the book text provided. Answer in JSON.",
    },
    {
      role: "user",
      content: `Book: ${bookTitle}
Term: ${r.term}${r.expansion ? ` (${r.expansion})` : ""}
The book says: """${r.definition.slice(0, 1200)}"""${r.context ? `\nMore context: """${r.context.slice(0, 1800)}"""` : ""}

Return JSON with "definition": one plain-language sentence of at most 25 words explaining what the term means as this book uses it. Do not start with the term itself.`,
    },
  ];
}
