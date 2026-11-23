import { describe, expect, it } from "vitest";
import type { Block, BookDoc, Span } from "../model.ts";
import { bestLongForm, buildMatcher, extractGlossary, findAcronyms, singular } from "./extract.ts";

const P = (id: string, spans: Span[] | string): Block => ({
  kind: "paragraph",
  id,
  page: Number(id.slice(1)),
  chapter: 1,
  rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
  spans: typeof spans === "string" ? [{ text: spans }] : spans,
});

function book(blocks: Block[]): BookDoc {
  return {
    version: 1,
    id: "b",
    title: "T",
    fileName: "t.pdf",
    pageCount: 10,
    pages: Array.from({ length: 10 }, (_, i) => ({ w: 1, h: 1, label: String(i + 1) })),
    blocks: [{ kind: "heading", id: "h0", level: 1, text: "One", number: "1", page: 0, chapter: 1, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } }, ...blocks],
    toc: [],
    chapters: [
      { title: "Front", start: 0, end: 0, refs: {} },
      { title: "One", number: "1", start: 0, end: blocks.length + 1, refs: {} },
    ],
    stats: { bodySize: 10, bodyFont: "S", words: 0, figures: 0, tables: 0, boxes: 0, noiseRuns: 0, ms: 0 },
  };
}

describe("acronyms", () => {
  it("finds the long form, including plurals and word initials", () => {
    const hits = findAcronyms("Many temporomandibular disorders (TMDs) involve the American Academy of Orofacial Pain (AAOP).");
    expect(hits.map((h) => [h.sf, h.lf])).toEqual([
      ["TMDs", "temporomandibular disorders"],
      ["AAOP", "American Academy of Orofacial Pain"],
    ]);
  });
  it("ignores parentheses that are not acronyms", () => {
    expect(findAcronyms("pain (eg, burning) and costs (Fig 1-1) in 2016 (ICD-10 M26.6)")).toEqual([]);
  });
  it("matches letters inside words when initials don't spell it", () => {
    expect(bestLongForm("CGRP", "neuropeptides such as calcitonin gene-related peptide")).toBe("calcitonin gene-related peptide");
  });
});

describe("singular", () => {
  it("handles English plurals and leaves Latin singulars alone", () => {
    expect(["disorders", "therapies", "processes", "diseases", "arthritis", "torticollis", "shingles", "migrans"].map(singular)).toEqual([
      "disorder",
      "therapy",
      "process",
      "disease",
      "arthritis",
      "torticollis",
      "shingles",
      "migrans",
    ]);
  });
});

describe("extractGlossary", () => {
  const g = extractGlossary(
    book([
      P("b1", "Many temporomandibular disorders (TMDs) are chronic. TMD treatment varies."),
      P("b2", [{ text: "The term " }, { text: "nociplastic pain", i: true }, { text: " is mentioned here first." }]),
      P("b3", [{ text: "Nociplastic pain", i: true }, { text: " is defined as pain from altered nociception without tissue damage." }]),
      P("b4", [{ text: "Patients with " }, { text: "Sjögren syndrome", i: true }, { text: " are discussed; in Sjögren syndrome the glands are inflamed." }]),
      P("b5", [{ text: "This is " }, { text: "not", i: true }, { text: " a term, and " }, { text: "primary", i: true }, { text: " is too generic." }]),
      P("b6", "Later, nociplastic pains and TMDs are compared, as is Sjögren syndrome."),
    ]),
  );
  const by = (k: string) => g.find((t) => t.key === k);

  it("extracts acronyms with a singular expansion", () => {
    expect(by("TMD")).toMatchObject({ kind: "acronym", expansion: "temporomandibular disorder", blockId: "b1" });
    expect(by("TMD")!.occurrences).toEqual([1, 6]);
  });
  it("keeps the sentence that best defines a term", () => {
    expect(by("nociplastic pain")!.definition).toMatch(/^Nociplastic pain is defined as/);
    expect(by("nociplastic pain")!.blockId).toBe("b3");
  });
  it("keeps proper names capitalised and skips emphasis words", () => {
    expect(by("sjögren syndrome")!.term).toBe("Sjögren syndrome");
    expect(by("not")).toBeUndefined();
    expect(by("primary")).toBeUndefined();
  });
});

describe("buildMatcher", () => {
  const terms = [
    { key: "TMD", kind: "acronym" as const, term: "TMD", aliases: ["TMD", "TMDs", "temporomandibular disorder", "temporomandibular disorders"], definition: "", blockId: "", blockIndex: 0, page: 0, occurrences: [] },
    { key: "pain", kind: "term" as const, term: "pain", aliases: ["pain"], definition: "", blockId: "", blockIndex: 0, page: 0, occurrences: [] },
    { key: "chronic pain", kind: "term" as const, term: "chronic pain", aliases: ["chronic pain"], definition: "", blockId: "", blockIndex: 0, page: 0, occurrences: [] },
  ];
  const m = buildMatcher(terms);
  it("prefers the longest match and respects acronym case", () => {
    const text = "Chronic pain in TMDs; tmd is not matched; Temporomandibular disorders hurt.";
    expect(m(text).map((x) => text.slice(x.start, x.end))).toEqual(["Chronic pain", "TMDs", "Temporomandibular disorders"]);
  });
  it("matches whole words only", () => {
    expect(m("painful painless pain-free")).toEqual([]);
  });
});
