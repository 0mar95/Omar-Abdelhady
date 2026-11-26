import { describe, expect, it } from "vitest";
import { EXTRACTOR_VERSION, blockText, type Block, type BookDoc } from "./model";
import { readingUnits, WPM } from "./units";

const rect = { x0: 0, y0: 0, x1: 1, y1: 1 };
let id = 0;
const h = (level: 1 | 2, text: string, number?: string): Block => ({ kind: "heading", id: `b${id++}`, level, text, number, chapter: 0, page: id, rect });
/** A paragraph of about `minutes` minutes' reading. */
const p = (minutes: number): Block => ({ kind: "paragraph", id: `b${id++}`, chapter: 0, page: id, rect, spans: [{ text: "word ".repeat(Math.round(minutes * WPM)).trim() }] });

function units(blocks: Block[]) {
  const book = { version: EXTRACTOR_VERSION, id: "b", title: "Book", fileName: "b.pdf", pageCount: 1, pages: [], blocks, toc: [], chapters: [], stats: {} } as unknown as BookDoc;
  const wb: number[] = [];
  let w = 0;
  for (const b of blocks) {
    wb.push(w);
    w += (blockText(b).match(/\S+/g) ?? []).length;
  }
  return readingUnits(book, wb, w);
}

describe("reading units", () => {
  it("folds the front and back matter and keeps trusted chapters", () => {
    const u = units([h(1, "Preface"), p(4), h(1, "Foreword"), p(2), h(1, "Pain", "1"), p(20), h(1, "Sleep", "2"), p(18), h(1, "Jaw", "3"), p(25), h(1, "References"), p(5), h(1, "Index"), p(3)]);
    expect(u.trusted).toBe(true);
    expect(u.units.map((x) => [x.kind, x.number ?? "", x.title])).toEqual([
      ["front", "", "Before the book"],
      ["read", "1", "Pain"],
      ["read", "2", "Sleep"],
      ["read", "3", "Jaw"],
      ["back", "", "After the book"],
    ]);
  });

  it("splits a long chapter at its sections, into parts of a comfortable length", () => {
    const u = units([h(1, "Pain", "1"), p(15), h(2, "Mechanisms"), p(18), h(2, "Diagnosis"), p(17), h(2, "Treatment"), p(16), h(1, "Sleep", "2"), p(20), h(1, "Jaw", "3"), p(20)]);
    const pain = u.units.filter((x) => x.number === "1");
    expect(pain.length).toBeGreaterThanOrEqual(2);
    expect(pain.every((x) => x.part?.of === pain.length && x.chapterTitle === "Pain")).toBe(true);
    for (const x of pain) expect(x.minutes).toBeLessThanOrEqual(42);
    expect(pain[1].title).toMatch(/Diagnosis|Mechanisms|Treatment/);
  });

  it("treats an appendix inside the last chapter as back matter", () => {
    const u = units([h(1, "A", "1"), p(20), h(1, "B", "2"), p(20), h(1, "C", "3"), p(20), h(2, "Appendix 1"), p(10)]);
    expect(u.units[u.units.length - 1]).toMatchObject({ kind: "back" });
    expect(u.units.filter((x) => x.kind === "read").map((x) => x.number)).toEqual(["1", "2", "3"]);
  });

  it("cuts a book without usable chapters by reading time, at its strongest breaks", () => {
    const blocks: Block[] = [h(1, "Everything")];
    for (let k = 0; k < 8; k++) blocks.push(h(2, `Topic ${k + 1}`), p(9));
    const u = units(blocks);
    expect(u.trusted).toBe(false);
    const reads = u.units.filter((x) => x.kind === "read");
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const x of reads) expect(x.minutes).toBeLessThanOrEqual(31);
    expect(reads.slice(1).every((x) => /^Topic \d$/.test(x.title))).toBe(true);
  });

  it("joins a tiny unnumbered chapter to its neighbour", () => {
    const u = units([h(1, "A", "1"), p(20), h(1, "Interlude"), p(1), h(1, "B", "2"), p(20), h(1, "C", "3"), p(20)]);
    expect(u.units.some((x) => x.title === "Interlude")).toBe(false);
  });
});
