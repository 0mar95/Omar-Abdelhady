import { describe, expect, it } from "vitest";
import { EXTRACTOR_VERSION, type Block, type BookDoc } from "./model.ts";
import { awayFor, recapMaterial, recapMessages } from "./recap.ts";

const rect = { x0: 0, y0: 0, x1: 1, y1: 1 };
const para = (id: string, chapter: number, text: string): Block => ({ kind: "paragraph", id, chapter, page: 0, rect, spans: [{ text }] });
const head = (id: string, level: 1 | 2 | 3, text: string, chapter: number): Block => ({ kind: "heading", id, level, text, chapter, page: 0, rect });
const words = (topic: string, n = 200) => `${topic} ${"word ".repeat(n)}`.trim();

// Two chapters, three sections each; every paragraph is ~200 words.
function makeBook(): BookDoc {
  const blocks: Block[] = [];
  for (const [c, name] of ["Pain", "Sleep"].entries()) {
    blocks.push(head(`c${c}`, 1, name, c));
    for (let s = 0; s < 3; s++) {
      blocks.push(head(`c${c}s${s}`, 2, `${name} section ${s}`, c));
      for (let p = 0; p < 3; p++) blocks.push(para(`c${c}s${s}p${p}`, c, words(`${name}-${s}-${p}`)));
    }
  }
  const chapters = [0, 1].map((c) => {
    const start = blocks.findIndex((b) => b.id === `c${c}`);
    const end = c === 0 ? blocks.findIndex((b) => b.id === "c1") : blocks.length;
    return { title: c ? "Sleep" : "Pain", number: String(c + 1), start, end, refs: {} };
  });
  return {
    version: EXTRACTOR_VERSION,
    id: "b",
    title: "Book",
    fileName: "b.pdf",
    pageCount: 1,
    pages: [{ w: 1, h: 1, label: "1" }],
    blocks,
    toc: [],
    chapters,
    stats: { bodySize: 10, bodyFont: "Serif", words: 0, figures: 0, tables: 0, boxes: 0, noiseRuns: 0, ms: 0 },
  };
}

const at = (book: BookDoc, id: string) => book.blocks.findIndex((b) => b.id === id);

describe("recapMaterial", () => {
  const book = makeBook();
  const notes = new Map([["c0s0", { summary: "Pain section zero in one line." }]]);

  it("never includes text past the reading position", () => {
    const pos = at(book, "c1s0p1");
    for (const scope of ["recent", "chapter", "book"] as const) {
      const m = recapMaterial(book, pos, scope, notes);
      expect(m.passage).toContain("Sleep-0-1");
      expect(m.passage).not.toContain("Sleep-0-2");
      expect(m.outline.every((o) => o.blockIndex <= pos)).toBe(true);
      expect(m.stoppedAt.blockId).toBe("c1s0p1");
      expect(m.stoppedAt.path).toContain("Sleep section 0");
    }
  });

  it("recent: the latest text, with the sections before it as an outline", () => {
    const m = recapMaterial(book, at(book, "c1s1p0"), "recent", notes);
    // ~1300 words back reaches into chapter 1; earlier sections become the outline.
    expect(m.passage).toContain("Sleep-1-0");
    expect(m.passage).toContain("## Sleep section 1");
    expect(m.outline.length).toBeGreaterThan(0);
    expect(m.outline.length).toBeLessThanOrEqual(4);
  });

  it("chapter: stays inside the current chapter", () => {
    const m = recapMaterial(book, at(book, "c1s2p2"), "chapter", notes);
    expect(m.passage).not.toContain("Pain-");
    expect(m.outline.map((o) => o.blockId)).toEqual(["c1s0", "c1s1", "c1s2"]);
  });

  it("book: uses notes where they exist and section openings otherwise", () => {
    const m = recapMaterial(book, at(book, "c1s2p2"), "book", notes);
    expect(m.outline).toHaveLength(6);
    expect(m.outline[0].summary).toBe("Pain section zero in one line.");
    expect(m.outline[1].summary).toBeUndefined();
    expect(m.outline[1].opening).toMatch(/^Pain-1-0/);
    const [, user] = recapMessages(book.title, "Chapter 2: Sleep", m);
    expect(user.content).toContain("Pain section zero in one line.");
    expect(user.content).toContain("Chapter 2: Sleep");
  });

  it("is empty at the very start of a book", () => {
    expect(recapMaterial(book, 0, "recent", notes).empty).toBe(true);
    expect(recapMaterial(book, at(book, "c0s0p1"), "recent", notes).empty).toBe(false);
  });
});

describe("awayFor", () => {
  it("rounds to a friendly unit", () => {
    const h = 3600_000;
    expect(awayFor(5 * 60_000)).toBe("5 minutes");
    expect(awayFor(5 * h)).toBe("5 hours");
    expect(awayFor(3 * 24 * h)).toBe("3 days");
    expect(awayFor(21 * 24 * h)).toBe("3 weeks");
    expect(awayFor(90 * 24 * h)).toBe("3 months");
  });
});
