// The user's own books, held to the same contract every time the engine
// changes: the right title, chapters in order, the opening pages sorted.
// The books themselves are never in the repository (copyright): each test
// runs when its file is present (BOOKS_DIR, or the default upload folder).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { BookDoc } from "./model.ts";
import { extractFromDocument } from "./pdf/extract.ts";

const DIR = process.env.BOOKS_DIR ?? "/root/.claude/uploads/89277f9a-ea34-5c1a-a74e-7e894964e6be";
const pdfDir = path.join(path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))), "/");

async function open(name: string): Promise<BookDoc | null> {
  const file = fs.existsSync(DIR) ? fs.readdirSync(DIR).find((f) => f.endsWith(name)) : undefined;
  if (!file) return null;
  const data = new Uint8Array(fs.readFileSync(path.join(DIR, file)));
  const doc = await pdfjs.getDocument({ data, verbosity: 0, fontExtraProperties: true, cMapUrl: `${pdfDir}cmaps/`, cMapPacked: true, standardFontDataUrl: `${pdfDir}standard_fonts/` }).promise;
  return extractFromDocument(doc, pdfjs as never, { id: name, fileName: file });
}

const chapters = (b: BookDoc) => b.chapters.filter((c) => c.title !== "Front matter").map((c) => (c.number ? `${c.number} ${c.title}` : c.title));
const about = (b: BookDoc) => b.blocks.find((x) => x.kind === "about");
const opening = (b: BookDoc) => b.blocks.slice(0, 3).map((x) => x.kind);
const anyText = (b: BookDoc, re: RegExp) => b.blocks.some((x) => x.kind === "paragraph" && re.test(x.spans.map((s) => s.text).join("")));

const books: { name: string; check(b: BookDoc): void }[] = [
  {
    name: "Orofacial_Pain_7.pdf",
    check(b) {
      expect(opening(b)).toEqual(["titlepage", "about", "contents"]);
      expect(chapters(b).slice(0, 3)).toEqual(["1 Introduction to Orofacial Pain", "2 General Assessment of the Orofacial Pain Patient", "3 Diagnostic Classification of Orofacial Pain"]);
      expect(chapters(b).length).toBeGreaterThanOrEqual(12);
    },
  },
  {
    name: "Techniques_for_Success_with_Implants_in_The_Esthetic_Zone.pdf",
    check(b) {
      const tp = b.blocks[0];
      expect(tp).toMatchObject({ kind: "titlepage", title: "Techniques for Success with Implants in the Esthetic Zone", byline: "Arndt Happe · Gerd Körner", edited: true });
      expect(about(b)?.kind === "about" && about(b)!.sections.map((s) => s.title)).toEqual(["Contributors", "Publication details"]);
      expect(chapters(b)).toEqual(["Foreword", "Preface", "1 Introduction"]);
      const c = b.blocks.find((x) => x.kind === "contents");
      expect(c?.kind === "contents" && c.entries.length).toBe(17);
      expect(anyText(b, /^Assessment of the esthetic quality/)).toBe(true); // the drop cap
    },
  },
  {
    name: "Fundamentals_of_Oral_Medicine_and_Radiology.pdf",
    check(b) {
      expect(b.blocks[0]).toMatchObject({ kind: "titlepage", title: "Fundamentals of Oral Medicine and Radiology", byline: "Durgesh N Bailoor · KS Nagesh" });
      expect(about(b)?.kind === "about" && about(b)!.sections.map((s) => s.title)).toEqual(expect.arrayContaining(["Contributors", "Acknowledgements", "Publication details"]));
      const c = b.blocks.find((x) => x.kind === "contents");
      expect(c?.kind === "contents" && c.entries.length).toBe(34);
    },
  },
  {
    name: "White_and_Pharoah_s_Oral_Radiology_-_pages_20-25.pdf",
    check(b) {
      expect(b.blocks.filter((x) => x.kind === "table").length).toBeGreaterThanOrEqual(1);
      expect(anyText(b, /This page intentionally left blank/)).toBe(false);
    },
  },
];

describe("the user's books", () => {
  for (const book of books)
    it(book.name, { timeout: 300_000 }, async () => {
      const b = await open(book.name);
      if (!b) return; // not on this machine
      book.check(b);
      expect(anyText(b, /^This page intentionally left blank\.?$/)).toBe(false);
    });
});
