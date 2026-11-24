// Quality audit: runs books through the engine and reports anything that
// doesn't look like a well-structured book. Every book should come out the
// same way: chapters that match its contents, headings in order, whole
// sentences, readable text.
//   npm run audit -- book1.pdf book2.epub notes.docx …
//   npm run audit -- --json report.json book.pdf
//   npm run audit -- --dump book.json book.pdf   (the converted book, for a closer look)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { auditBook, type AuditReport } from "../src/shared/audit.ts";
import { convertBook, detectFormat } from "../src/shared/formats/index.ts";
import type { BookDoc } from "../src/shared/model.ts";
import { bookIdFor, extractFromDocument } from "../src/shared/pdf/extract.ts";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const dumpAt = args.indexOf("--dump");
const dumpOut = dumpAt >= 0 ? args.splice(dumpAt, 2)[1] : null;
if (!args.length) {
  console.error("usage: npm run audit -- <book> [more books…]");
  process.exit(1);
}

async function load(file: string): Promise<BookDoc> {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const id = await bookIdFor(bytes);
  if (detectFormat(bytes, file) === "pdf") {
    // The same character maps and standard fonts the app gives pdf.js, so text comes out the same.
    const pdfDir = path.join(path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json"))), "/");
    const doc = await pdfjs.getDocument({
      data: bytes.slice(),
      verbosity: 0,
      fontExtraProperties: true,
      cMapUrl: `${pdfDir}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfDir}standard_fonts/`,
      wasmUrl: `${pdfDir}wasm/`,
    }).promise;
    return extractFromDocument(doc, pdfjs, { id, fileName: path.basename(file) });
  }
  const { DOMParser } = await import("linkedom");
  const mammoth = await import("mammoth");
  const { marked } = await import("marked");
  const { book } = await convertBook(
    bytes,
    { id, fileName: path.basename(file) },
    {
      parse: (s, type) => new DOMParser().parseFromString(s, type === "application/xhtml+xml" ? "text/html" : type) as unknown as Document,
      docxToHtml: async (b) => (await mammoth.convertToHtml({ buffer: Buffer.from(b) })).value,
      markdownToHtml: (md) => marked.parse(md, { async: false }) as string,
    },
  );
  return book;
}

const reports: (AuditReport & { file: string })[] = [];
for (const file of args) {
  try {
    const book = await load(file);
    const r = auditBook(book);
    reports.push({ file: path.basename(file), ...r });
    if (dumpOut) fs.writeFileSync(dumpOut, JSON.stringify(book, null, 1));
    const head = `${path.basename(file)} — ${book.format ?? "pdf"}, ${book.pageCount} pages, ${book.chapters.length} chapters, ${book.stats.words} words, score ${r.score}/100`;
    console.log(`\n${head}\n${"-".repeat(Math.min(100, head.length))}`);
    if (!r.issues.length) console.log("  no issues");
    for (const i of r.issues) {
      console.log(`  [${i.severity}] ${i.check}: ${i.message}`);
      for (const s of i.samples.slice(0, 3)) console.log(`      · ${s}`);
    }
  } catch (e) {
    console.log(`\n${path.basename(file)} — FAILED TO OPEN: ${e instanceof Error ? e.message : String(e)}`);
    reports.push({ file: path.basename(file), score: 0, issues: [{ check: "open", severity: "error", message: String(e), samples: [] }], metrics: {} });
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(reports, null, 2));
console.log(`\n${reports.length} book(s), average score ${Math.round(reports.reduce((a, r) => a + r.score, 0) / Math.max(1, reports.length))}/100`);
