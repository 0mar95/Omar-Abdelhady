import { describe, expect, it } from "vitest";
import type { Block, BookDoc } from "../model.ts";
import { ftsQuery, fuse, noteSections } from "./chunks.ts";

describe("ftsQuery", () => {
  it("quotes words and adds a prefix match to the last one", () => {
    expect(ftsQuery("Trigeminal neuralg")).toBe('"trigeminal" "neuralg"*');
    expect(ftsQuery("pain OR (drop)", "or")).toBe('"pain" OR "drop"*');
    expect(ftsQuery("What are the red flags for secondary headaches?")).toBe('"red" "flags" "secondary" "headaches"*');
  });
  it("neutralizes FTS syntax", () => {
    expect(ftsQuery('"NEAR(a b)" col:x -y *')).toBe('"near" "col"*');
    expect(ftsQuery("   ")).toBeNull();
  });
});

describe("fuse", () => {
  it("ranks items found by both lists first", () => {
    const s = fuse([
      [
        { key: 1, rank: 0 },
        { key: 2, rank: 1 },
      ],
      [
        { key: 2, rank: 0 },
        { key: 3, rank: 1 },
      ],
    ]);
    const order = [...s.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    expect(order[0]).toBe(2);
  });
});

describe("noteSections", () => {
  const rect = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const text = "word ".repeat(120);
  // Four chapters, only one with a printed number (a stray "8" picked up from a stat).
  const blocks: Block[] = [0, 1, 2, 3].flatMap((c) => [
    { kind: "heading", id: `c${c}`, level: 1, text: `Chapter ${c}`, chapter: c, page: 0, rect } as Block,
    { kind: "heading", id: `c${c}s`, level: 2, text: `Section ${c}`, chapter: c, page: 0, rect } as Block,
    { kind: "paragraph", id: `c${c}p`, chapter: c, page: 0, rect, spans: [{ text }] } as Block,
  ]);
  const book = {
    blocks,
    chapters: [0, 1, 2, 3].map((c) => ({ title: `Chapter ${c}`, number: c === 2 ? "8" : undefined, start: c * 3, end: c * 3 + 3, refs: {} })),
  } as unknown as BookDoc;

  it("keeps notes for unnumbered chapters when only a few chapters have numbers", () => {
    expect(noteSections(book).map((s) => s.blockId)).toEqual(["c0s", "c1s", "c2s", "c3s"]);
  });
});
