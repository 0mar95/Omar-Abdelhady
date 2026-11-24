import { describe, expect, it } from "vitest";
import type { Block, HeadingBlock, ParagraphBlock } from "./model.ts";
import { normalizeStructure, tidyHeading } from "./normalize.ts";

const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
let n = 0;
const h = (text: string, level: 1 | 2 | 3 | 4 = 1, page = 0): HeadingBlock => ({ kind: "heading", id: `b${n++}`, page, rect: R, chapter: 0, level, text });
const p = (text: string, page = 0): ParagraphBlock => ({ kind: "paragraph", id: `b${n++}`, page, rect: R, chapter: 0, spans: [{ text }] });
const textOf = (b: Block) => (b.kind === "paragraph" ? b.spans.map((s) => s.text).join("") : b.kind === "heading" ? b.text : "");

describe("tidyHeading", () => {
  it("turns ALL CAPS into title case and keeps roman numerals", () => {
    expect(tidyHeading("THE HYPOTHALAMUS AND PAIN")).toBe("The Hypothalamus and Pain");
    expect(tidyHeading("CHAPTER IV")).toBe("Chapter IV");
  });
  it("drops dot leaders and page numbers", () => {
    expect(tidyHeading("Introduction ........ 12")).toBe("Introduction");
  });
});

describe("normalizeStructure", () => {
  it("merges a 'Chapter N' label with the title after it", () => {
    const out = normalizeStructure([h("Chapter 3"), h("Distributions"), p("Text.")]) as Block[];
    expect(out[0]).toMatchObject({ kind: "heading", number: "3", text: "Distributions" });
    expect(out).toHaveLength(2);
  });

  it("numbers '3. Title' chapter headings", () => {
    const [first] = normalizeStructure([h("3. Muscle Pain")]);
    expect(first).toMatchObject({ number: "3", text: "Muscle Pain" });
  });

  it("joins a sentence broken across a figure", () => {
    const fig: Block = { kind: "figure", id: "f", page: 0, rect: R, chapter: 0, caption: [] } as unknown as Block;
    const out = normalizeStructure([p("The beam passes through"), fig, p("the patient and strikes the sensor.")]);
    expect(out.map(textOf)[0]).toBe("The beam passes through the patient and strikes the sensor.");
  });

  it("removes a line-break hyphen when joining", () => {
    const out = normalizeStructure([p("an increase in temper-"), p("ature follows.")]);
    expect(textOf(out[0])).toBe("an increase in temperature follows.");
  });

  it("keeps glossary entries apart", () => {
    const out = normalizeStructure([p("interpreter: A program that reads another program and executes it"), p("prompt: Characters displayed by the interpreter.")]);
    expect(out).toHaveLength(2);
  });

  it("never lets heading levels skip", () => {
    const out = normalizeStructure([h("One", 1), h("Deep", 4), h("Deeper", 4)]).filter((b): b is HeadingBlock => b.kind === "heading");
    expect(out.map((b) => b.level)).toEqual([1, 2, 2]);
  });

  it("promotes second-level headings to chapters in a long book with no chapters", () => {
    const body = p("word ".repeat(16000));
    const out = normalizeStructure([h("Title", 1), h("A", 2), body, h("B", 2), h("C", 2)]).filter((b): b is HeadingBlock => b.kind === "heading");
    expect(out.map((b) => b.level)).toEqual([1, 1, 1, 1]);
  });
});
