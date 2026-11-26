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

// One folder or several, separated by ":".
const DIRS = (process.env.BOOKS_DIR ?? "/root/.claude/uploads/89277f9a-ea34-5c1a-a74e-7e894964e6be").split(":");
const pdfDir = path.join(path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))), "/");

async function open(name: string, match?: RegExp): Promise<BookDoc | null> {
  let found: string | undefined;
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    const f = fs.readdirSync(dir).find((x) => x.endsWith(".pdf") && (match ? match.test(x) : x.endsWith(name)));
    if (f) {
      found = path.join(dir, f);
      break;
    }
  }
  if (!found) return null;
  const file = path.basename(found);
  const data = new Uint8Array(fs.readFileSync(found));
  const doc = await pdfjs.getDocument({ data, verbosity: 0, fontExtraProperties: true, cMapUrl: `${pdfDir}cmaps/`, cMapPacked: true, standardFontDataUrl: `${pdfDir}standard_fonts/` }).promise;
  return extractFromDocument(doc, pdfjs as never, { id: name, fileName: file });
}

const chapters = (b: BookDoc) => b.chapters.filter((c) => c.title !== "Front matter").map((c) => (c.number ? `${c.number} ${c.title}` : c.title));
const about = (b: BookDoc) => b.blocks.find((x) => x.kind === "about");
const opening = (b: BookDoc) => b.blocks.slice(0, 3).map((x) => x.kind);
const anyText = (b: BookDoc, re: RegExp) => b.blocks.some((x) => x.kind === "paragraph" && re.test(x.spans.map((s) => s.text).join("")));

const books: { name: string; match?: RegExp; check(b: BookDoc): void }[] = [
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
      // A scanned page with per-page font names: its text is text, not part of a figure.
      expect(b.stats.words).toBeGreaterThan(4000);
      expect(b.toc.map((t) => t.title)).toEqual(expect.arrayContaining(["Collimation", "Inverse Square Law"]));
      expect(anyText(b, /further limit the size of the beam/)).toBe(true);
      expect(anyText(b, /This page intentionally left blank/)).toBe(false);
    },
  },
  {
    name: "Essentials of Esthetic Dentistry (Smile Design)",
    match: /smile.design|esthetic-dentistry/i,
    check(b) {
      const opener = (n: string) => b.blocks.find((x) => x.kind === "heading" && x.level === 1 && x.number === n);
      expect(chapters(b)).toEqual(expect.arrayContaining(["3 Integration of Function and Esthetics", "7 Clear Aligner Therapy"]));
      expect(opener("3")).toMatchObject({ byline: "Jeffrey McClendon, Jonathan B. Levine" });
      expect(opener("5")).toMatchObject({ byline: "Kia Rezavandi" });
      // The chapter's own printed contents list is gone; its real first sentence follows.
      const i = b.blocks.indexOf(opener("3")!);
      expect(b.blocks[i + 1].kind).toBe("paragraph");
      expect(anyText(b, /^55 The neutral zone/)).toBe(false);
      expect(anyText(b, /J E F F R E Y/)).toBe(false);
    },
  },
  {
    name: "Understanding Masticatory Function in Unilateral Crossbites",
    match: /masticatory/i,
    check(b) {
      // Charts drawn with lines are figures: their labels don't spill into the text.
      expect(anyText(b, /^Sagittal plane$/)).toBe(false);
      expect(b.blocks.some((x) => x.kind === "figure" && x.key === "Fig 1-13")).toBe(true);
      expect(chapters(b)).toEqual(expect.arrayContaining(["1 Introductory Explanation of Masticatory Function"]));
    },
  },
  {
    name: "Fundamentals of Oral Medicine and Radiology (full)",
    match: /^Fundamentals of Oral Medicine and Radiology\.pdf$|oral-medicine-radiology-full/i,
    check(b) {
      expect(chapters(b).slice(0, 2)).toEqual(["1 The Diagnostic Sequence", "2 Systemically Compromised Dental Patients"]);
      const c1 = b.blocks.find((x) => x.kind === "heading" && x.level === 1 && x.number === "1");
      expect(c1).toMatchObject({ byline: "Bailoor DN, Nagesh KS, Chatra LK, Pai Keerthilatha" });
      // Running headers ("2 Fundamentals of Oral Medicine and Radiology") are not headings.
      expect(b.blocks.some((x) => x.kind === "heading" && /^\d+ Fundamentals of Oral Medicine/.test(x.text))).toBe(false);
    },
  },
  {
    name: "Dental Emergencies",
    match: /dental.emergencies/i,
    check(b) {
      // Bullets drawn with a symbol font are lists.
      expect(b.blocks.filter((x) => x.kind === "list").length).toBeGreaterThan(40);
      expect(anyText(b, /^\u0002/)).toBe(false);
    },
  },
];

describe("the user's books", () => {
  for (const book of books)
    it(book.name, { timeout: 300_000 }, async () => {
      const b = await open(book.name, book.match);
      if (!b) return; // not on this machine
      book.check(b);
      expect(anyText(b, /^This page intentionally left blank\.?$/)).toBe(false);
    });
});
