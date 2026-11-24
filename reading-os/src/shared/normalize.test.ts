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

describe("opening pages", () => {
  const imprintPage = [
    p("This edition first published 2012 © 2012 by Blackwell Publishing Ltd", 5),
    p("All rights reserved. No part of this publication may be reproduced.", 5),
    p("Library of Congress Cataloging-in-Publication Data", 5),
    { kind: "list", id: "l", page: 5, rect: R, chapter: 0, items: [[{ text: "; cm." }]] } as Block,
    p("ISBN 978-0-470-67396-6 (pbk. : alk. paper)", 5),
    p(",", 5),
  ];

  it("folds the copyright page into one publication-details block", () => {
    const out = normalizeStructure([h("Dental Emergencies", 1, 0), ...imprintPage, h("Contents", 1, 7), p("Body.", 7)]);
    const imprint = out.filter((b) => b.kind === "imprint");
    expect(imprint).toHaveLength(1);
    expect(imprint[0].kind === "imprint" && imprint[0].lines.some((l) => l.includes("ISBN"))).toBe(true);
    expect(out.some((b) => textOf(b) === ",")).toBe(false);
  });

  it("keeps one title and turns the names on the title pages into text", () => {
    const out = normalizeStructure([h("Dental Emergencies", 1, 0), h("Mark Greenwood | Ian Corbett", 1, 0), h("Dental Emergencies", 1, 2), h("Edited by", 3, 4), ...imprintPage, h("Introduction", 1, 8)]);
    const heads = out.filter((b): b is HeadingBlock => b.kind === "heading").map((b) => b.text);
    expect(heads).toEqual(["Dental Emergencies", "Introduction"]);
    expect(out.some((b) => textOf(b) === "Mark Greenwood | Ian Corbett")).toBe(true);
  });

  it("leaves a preface before a late contents page alone", () => {
    const out = normalizeStructure([h("Think Python", 1, 0), h("Preface", 1, 4), p("Why I wrote it.", 4), { kind: "contents", id: "c", page: 12, rect: R, chapter: 0, entries: [] } as Block]);
    expect(out.filter((b) => b.kind === "heading")).toHaveLength(2);
  });
});

describe("web addresses", () => {
  const code = (line: string): Block => ({ kind: "code", id: `c${n++}`, page: 0, rect: R, chapter: 0, lines: [line] });
  it("puts an address set on its own line back into its sentence", () => {
    const out = normalizeStructure([p("The third edition is available at"), code("thinkpython.com"), p("Next.")]);
    expect(out).toHaveLength(2);
    expect(textOf(out[0])).toBe("The third edition is available at thinkpython.com");
  });
  it("rejoins an address broken after https:", () => {
    const first = p("License, which is available at ");
    first.spans.push({ text: "https:", code: true });
    const out = normalizeStructure([first, code("//creativecommons.org/licenses/by-nc/3.0/.")]);
    expect(textOf(out[0])).toBe("License, which is available at https://creativecommons.org/licenses/by-nc/3.0/.");
  });
  it("leaves real code alone", () => {
    expect(normalizeStructure([p("Run this:"), code("print(1)")])[1].kind).toBe("code");
  });
});

describe("title pages", () => {
  it("shows lines repeated on the half-title page once", () => {
    const out = normalizeStructure([p("Think Python", 0), p("2nd Edition", 0), p("Think Python", 2), p("2nd Edition", 2), p("Allen Downey", 2), p("Copyright © 2015 Allen Downey. All rights reserved.", 3), p("Printed in the USA. ISBN 1-2-3", 3)]);
    expect(out.filter((b) => b.kind === "paragraph").map(textOf)).toEqual(["Think Python", "2nd Edition", "Allen Downey"]);
  });
});
