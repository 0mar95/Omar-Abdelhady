import { describe, expect, it } from "vitest";
import { EXTRACTOR_VERSION, blockText, type Block, type BookDoc, type Span } from "../model";
import type { GlossaryTerm } from "../glossary/extract";
import { answerInQuote, bookQuestions, findQuote } from "./questions";

const rect = { x0: 0, y0: 0, x1: 1, y1: 1 };
const para = (id: string, spans: Span[]): Block => ({ kind: "paragraph", id, chapter: 0, page: 0, rect, spans });
const head = (id: string, text: string): Block => ({ kind: "heading", id, level: 2, text, chapter: 0, page: 0, rect });

function makeBook(): BookDoc {
  const blocks: Block[] = [
    head("h", "Radiation basics"),
    para("p1", [
      { text: "A device that restricts the size of the x-ray beam and the volume of tissue irradiated is called a " },
      { text: "collimator", b: true },
      { text: ". Typical exposures for intraoral radiographs use 70 kVp at the tube." },
    ]),
    para("p2", [
      { text: "Photons that change direction inside the patient and reduce image quality are known as " },
      { text: "scattered radiation", b: true },
      { text: ", and they account for 57% of all primary interactions.12" , },
    ]),
    para("p3", [{ text: "Other bold terms in the chapter: " }, { text: "filtration", b: true }, { text: ", " }, { text: "half-value layer", b: true }, { text: ", " }, { text: "inverse square law", b: true }, { text: "." }]),
    {
      kind: "table",
      id: "t1",
      chapter: 0,
      page: 0,
      rect,
      key: "Table 1-1",
      caption: [{ text: "Table 1-1 Receptor speeds" }],
      headerRows: 1,
      rows: [
        ["Receptor", "Speed group", "Relative dose"],
        ["D-speed film", "D", "100%"],
        ["E-speed film", "E", "50%"],
        ["F-speed film", "F", "40%"],
        ["Digital sensor", "—", "30%"],
      ],
      parts: [],
      notes: [],
    } as unknown as Block,
  ];
  return {
    version: EXTRACTOR_VERSION,
    id: "b",
    title: "Book",
    fileName: "b.pdf",
    pageCount: 1,
    pages: [{ w: 1, h: 1, label: "1" }],
    blocks,
    toc: [],
    chapters: [{ title: "Physics", number: "1", start: 0, end: blocks.length, refs: {} }],
    stats: { bodySize: 10, bodyFont: "Serif", words: 0, figures: 0, tables: 0, boxes: 0, noiseRuns: 0, ms: 0 },
  } as BookDoc;
}

const term = (key: string, t: string, definition: string, blockIndex: number, kind: "term" | "acronym" = "term", expansion?: string): GlossaryTerm => ({
  key,
  kind,
  term: t,
  expansion,
  aliases: [t],
  definition,
  blockId: `p${blockIndex}`,
  blockIndex,
  page: 0,
  occurrences: [blockIndex],
});

describe("bookQuestions", () => {
  const book = makeBook();
  const texts = book.blocks.map(blockText);
  const terms = [
    term("collimator", "collimator", "A device that restricts the size of the x-ray beam and the volume of tissue irradiated is called a collimator.", 1),
    term("kvp", "kVp", "", 1, "acronym", "kilovoltage peak"),
    term("hvl", "HVL", "", 3, "acronym", "half-value layer"),
    term("ppt", "PPT", "", 1, "acronym", "pain-evoking pressure stimuli"),
  ];
  const qs = bookQuestions(book, texts, { start: 0, end: book.blocks.length }, terms);

  it("makes several kinds of question, each with four distinct options and a source", () => {
    const kinds = new Set(qs.map((q) => q.kind));
    expect(kinds.has("definition")).toBe(true);
    expect(kinds.has("number")).toBe(true);
    expect(kinds.has("table")).toBe(true);
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options!.map((o) => o.toLowerCase())).size).toBe(4);
      expect(q.blockId).toBeTruthy();
      expect(q.options!.some((o) => /opposite of that|nothing about it|something unrelated/i.test(o))).toBe(false);
    }
  });

  it("blanks the answer and offers real terms from the chapter as wrong options", () => {
    const def = qs.find((q) => q.kind === "definition")!;
    expect(def.q).toContain("_____");
    expect(def.q).not.toMatch(/collimator/i);
    expect(def.options![def.answer as number]).toBe("collimator");
    expect(def.options).toEqual(expect.arrayContaining(["filtration"]));
  });

  it("asks numbers without citation marks, with wrong values written the same way", () => {
    const num = qs.find((q) => q.kind === "number" && /57%|_____ of all/.test(q.q + q.options!.join()))!;
    expect(num.q).not.toMatch(/\.12/);
    for (const o of num.options!) expect(o).toMatch(/^\d+%$/);
  });

  it("asks about a table cell, with the other rows as wrong options", () => {
    const t = qs.find((q) => q.kind === "table")!;
    expect(t.q).toMatch(/Receptor speeds/);
    expect(t.options).toHaveLength(4);
  });

  it("never asks about an acronym whose expansion doesn't spell it", () => {
    expect(qs.some((q) => /PPT/.test(q.q))).toBe(false);
  });
});

describe("checking AI questions", () => {
  const blocks = [{ id: "p1", text: "Pericranial tenderness on palpation is the most significant abnormal finding. It increases with the intensity of the headache." }];
  it("finds a quote that is really in the text, and rejects one that isn't", () => {
    expect(findQuote("Pericranial tenderness on palpation is the most significant abnormal finding.", blocks)?.blockId).toBe("p1");
    expect(findQuote("Photophobia is the hallmark of tension-type headache in most patients.", blocks)).toBeNull();
  });
  it("checks the answer against the quote, numbers exactly", () => {
    expect(answerInQuote("Pericranial tenderness", blocks[0].text)).toBe(true);
    expect(answerInQuote("Photophobia", blocks[0].text)).toBe(false);
    expect(answerInQuote("70%", "Prevalence may exceed 70% in some populations.")).toBe(true);
    expect(answerInQuote("80%", "Prevalence may exceed 70% in some populations.")).toBe(false);
  });
});
