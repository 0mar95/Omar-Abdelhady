import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BookDoc, Block } from "../shared/model";
import { EXTRACTOR_VERSION } from "../shared/model";
import { LibraryIndex, bestSentence, type LibraryDeps } from "./library";

// Deterministic stand-in for an embedding model: hashed bag of word stems.
function fakeEmbed(texts: string[]): Float32Array[] {
  return texts.map((t) => {
    const v = new Float32Array(64);
    for (const w of t.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      let h = 0;
      for (const ch of w.slice(0, 6)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % 64] += 1;
    }
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  });
}

const para = (id: string, chapter: number, page: number, text: string): Block => ({
  kind: "paragraph",
  id,
  chapter,
  page,
  rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
  spans: [{ text }],
});
const head = (id: string, level: 1 | 2 | 3, text: string, chapter: number): Block => ({
  kind: "heading",
  id,
  level,
  text,
  chapter,
  page: 0,
  rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
});

const filler = (topic: string) => `${topic} is discussed at length here with clinical detail and examples. `.repeat(12);

function makeBook(id = "book1"): BookDoc {
  const blocks: Block[] = [
    head("h1", 1, "Neuropathic Pain", 0),
    head("h2", 2, "Trigeminal neuralgia", 0),
    para("p1", 0, 1, `Trigeminal neuralgia causes brief electric shock-like facial pain triggered by light touch. ${filler("Carbamazepine treatment")}`),
    head("h3", 2, "Burning mouth syndrome", 0),
    para("p2", 0, 2, `Burning mouth syndrome is a chronic burning sensation of the oral mucosa without visible lesions. ${filler("Oral mucosa burning")}`),
    head("h4", 2, "Sleep bruxism", 0),
    para("p3", 0, 3, `Sleep bruxism is rhythmic jaw muscle activity during sleep, often with tooth grinding. ${filler("Grinding teeth at night")}`),
  ];
  return {
    version: EXTRACTOR_VERSION,
    id,
    title: id === "book1" ? "Test Book" : "Second Book",
    fileName: "test.pdf",
    pageCount: 4,
    pages: [0, 1, 2, 3].map((i) => ({ w: 400, h: 600, label: String(i + 1) })),
    blocks,
    toc: [],
    chapters: [{ title: "Neuropathic Pain", start: 0, end: blocks.length, refs: {} }],
    stats: { bodySize: 10, bodyFont: "Serif", words: 600, figures: 0, tables: 0, boxes: 0, noiseRuns: 0, ms: 0 },
  };
}

let dir: string;
let lib: LibraryIndex | null = null;

function open(over: Partial<LibraryDeps> = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "readingos-"));
  const notes: string[] = [];
  const defined: string[] = [];
  const events: unknown[] = [];
  const deps: LibraryDeps = {
    loadBook: async (id) => makeBook(id),
    writeDefinition: async (_cfg, title, req) => {
      defined.push(req.key);
      return { definition: `  A ${req.term} definition from ${title}.  ` };
    },
    emitGlossary: (e) => events.push(e),
    embed: async (_cfg, texts) => fakeEmbed(texts),
    writeNote: async (_cfg, _book, s) => {
      notes.push(s.blockId);
      return { summary: `This section discusses ${s.path.split(" › ").pop()}.`, concepts: ["Concept A", "concept a", "Concept B"] };
    },
    userBusy: () => false,
    emitStatus: () => {},
    emitNote: () => {},
    isModelMissing: () => false,
    isOffline: () => false,
    ...over,
  };
  lib = new LibraryIndex(path.join(dir, "lib.sqlite"), deps);
  return { lib, notes, defined, events };
}

afterEach(() => {
  lib?.close();
  lib = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("LibraryIndex", () => {
  it("indexes a book and finds exact words with stemming", async () => {
    const { lib } = open();
    const st = await lib.indexBook("book1", "Test Book");
    expect(st.chunks).toBeGreaterThan(0);
    const hits = await lib.search({ q: "neuralgias", bookId: "book1" });
    expect(hits[0].blockId).toBe("p1");
    expect(hits[0].snippet).toContain("\u0001");
    expect(hits[0].section).toContain("Trigeminal neuralgia");
  });

  it("respects the reading-position limit", async () => {
    const { lib } = open();
    await lib.indexBook("book1", "Test Book");
    expect((await lib.search({ q: "bruxism", bookId: "book1" })).length).toBeGreaterThan(0);
    expect(await lib.search({ q: "bruxism", bookId: "book1", maxBlock: 3 })).toEqual([]);
  });

  it("embeds in the background and adds meaning-based matches", async () => {
    const { lib } = open();
    await lib.indexBook("book1", "Test Book");
    await lib.whenIdle();
    const st = lib.status("book1");
    expect(st.embedded).toBe(st.chunks);
    expect(st.state).toBe("ready");
    // No chunk contains the word "night-time"; the fake embedding links "grinding teeth".
    const hits = await lib.search({ q: "grinding teeth", bookId: "book1" });
    expect(hits.some((h) => h.blockId === "p3")).toBe(true);
  });

  it("writes margin notes around the reading position and cleans them", async () => {
    const { lib, notes } = open();
    await lib.indexBook("book1", "Test Book", 3);
    await lib.whenIdle();
    expect(notes[0]).toBe("h3"); // the section being read comes first
    const saved = lib.notes("book1");
    expect(saved.length).toBe(3);
    const n = saved.find((x) => x.blockId === "h3")!;
    expect(n.summary).toBe("Burning mouth syndrome.");
    expect(n.concepts).toEqual(["Concept A", "Concept B"]);
  });

  it("keeps exact search working when the embedding model is missing", async () => {
    const { lib } = open({
      embed: async () => {
        throw new Error("missing");
      },
      isModelMissing: () => true,
    });
    await lib.indexBook("book1", "Test Book");
    await lib.whenIdle();
    expect(lib.status("book1").state).toBe("no-embed-model");
    expect((await lib.search({ q: "carbamazepine", bookId: "book1" }))[0].blockId).toBe("p1");
  });
});

describe("glossary", () => {
  it("defines a hovered term before background work, stores and reuses it", async () => {
    const { lib, defined, events, notes } = open();
    await lib.indexBook("book1", "Test Book", 0);
    expect(lib.requestDefinition("book1", { key: "bruxism", term: "bruxism", definition: "Sleep bruxism is rhythmic jaw muscle activity." })).toBeNull();
    await lib.whenIdle();
    expect(defined).toEqual(["bruxism"]);
    // Asked while notes were running, but answered before most of them.
    expect(notes.length).toBeGreaterThan(0);
    expect(events).toContainEqual({ bookId: "book1", key: "bruxism", definition: "A bruxism definition from Test Book." });
    expect(lib.definitions("book1")).toEqual({ bruxism: "A bruxism definition from Test Book." });
    expect(lib.requestDefinition("book1", { key: "bruxism", term: "bruxism", definition: "" })).toBe("A bruxism definition from Test Book.");
    expect(defined).toEqual(["bruxism"]);
  });

  it("finds a term in other books, with word variants", async () => {
    const { lib } = open();
    await lib.indexBook("book1", "Test Book", 0);
    await lib.indexBook("book2", "Second Book", 0);
    const m = lib.mentions(["burning mouth syndromes", "BMS"], "book1");
    expect(m).toEqual([{ bookId: "book2", title: "Second Book", count: expect.any(Number), blockId: "p2" }]);
    expect(lib.mentions(["unicorn physiology"], "book1")).toEqual([]);
  });
});

describe("bestSentence", () => {
  it("picks and marks the sentence matching the query", () => {
    const s = bestSentence("Pain is common. Sleep bruxism involves grinding. Other things.", "teeth grinding at night");
    expect(s).toBe("Sleep bruxism involves \u0001grinding\u0002.");
  });
});
