// Command-line extractor: runs the same pipeline as the app on a PDF (or an
// EPUB, Word, HTML, Markdown or text file) and writes the structured book
// (JSON) plus a quick HTML preview to .extract/.
//   npm run extract -- path/to/book.pdf

import fs from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { convertBook, detectFormat } from "../src/shared/formats/index.ts";
import { blockText, type Block, type BookDoc, type Span } from "../src/shared/model.ts";
import { bookIdFor, extractFromDocument } from "../src/shared/pdf/extract.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run extract -- <file.pdf>");
  process.exit(1);
}
const bytes = new Uint8Array(fs.readFileSync(file));
const id = await bookIdFor(bytes);
let book: BookDoc;
if (detectFormat(bytes, file) === "pdf") {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false, fontExtraProperties: true }).promise;
  book = await extractFromDocument(doc, pdfjs, { id, fileName: path.basename(file) }, (p) => {
    if (p.phase === "reading" && p.done % 40 === 0) process.stderr.write(`  read ${p.done}/${p.total}\n`);
  });
} else {
  // EPUB, Word, HTML, Markdown, text — the same converters the app uses.
  const { DOMParser } = await import("linkedom");
  const mammoth = await import("mammoth");
  const { marked } = await import("marked");
  ({ book } = await convertBook(
    bytes,
    { id, fileName: path.basename(file) },
    {
      parse: (s, type) => new DOMParser().parseFromString(s, type === "application/xhtml+xml" ? "text/html" : type) as unknown as Document,
      docxToHtml: async (b) => (await mammoth.convertToHtml({ buffer: Buffer.from(b) })).value,
      markdownToHtml: (md) => marked.parse(md, { async: false }) as string,
    },
  ));
}
const outDir = path.resolve(".extract");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "book.json"), JSON.stringify(book));

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const spans = (ss: Span[]) =>
  ss
    .map((s) => {
      let t = esc(s.text);
      if (s.cite) return `<sup class=c title="${s.cite.join(",")}">${t}</sup>`;
      if (s.sup) t = `<sup>${t}</sup>`;
      if (s.i) t = `<i>${t}</i>`;
      if (s.b) t = `<b>${t}</b>`;
      if (s.xref) t = `<a class=x>${t}</a>`;
      if (s.pageRef !== undefined) t = `<a class=p>${t}</a>`;
      return t;
    })
    .join("");
const render = (b: Block): string => {
  const pg = `<span class=pg>p${b.page + 1}·${book.pages[b.page].label}</span>`;
  switch (b.kind) {
    case "heading":
      return `<h${b.level}>${pg}${b.number ? `<small>${b.number}</small> ` : ""}${esc(b.text)}</h${b.level}>`;
    case "paragraph":
      return `<p class="${b.small ? "small" : ""}">${pg}${spans(b.spans)}</p>`;
    case "list":
      return `<${b.ordered ? "ol" : "ul"}>${pg}${b.items.map((i) => `<li>${spans(i)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
    case "figure":
      if (b.image) return `<figure>${pg}<div class=img>[image ${esc(b.image.slice(0, 80))}]</div><figcaption><b>${b.key ?? ""}</b> ${spans(b.caption)}</figcaption></figure>`;
      return `<figure>${pg}<div class=img>[figure ${b.key ?? "(uncaptioned)"} · crop ${Object.values(b.rect).map((n) => n.toFixed(0)).join(",")}]<br><small>${esc(b.labels ?? "")}</small></div><figcaption><b>${b.key ?? ""}</b> ${spans(b.caption)}</figcaption></figure>`;
    case "table":
      return `<div class=tbl>${pg}<b>${b.key}</b> ${spans(b.caption)} <small>(${b.parts.length} part(s))</small><table>${b.rows
        .map((r, i) => `<tr>${r.map((c) => (i < b.headerRows ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`)
        .join("")}</table>${b.notes.map((n) => `<p class=small>${spans(n)}</p>`).join("")}</div>`;
    case "box":
      return `<aside>${pg}<b>${b.key}</b> ${spans(b.title)}${b.body.map(render).join("")}</aside>`;
    case "callout":
      return `<aside class=call>${pg}<b>${esc(b.title)}</b><ul>${b.items.map((i) => `<li>${spans(i)}</li>`).join("")}</ul></aside>`;
    case "references":
      return `<details>${pg}<summary>${esc(b.title)} (${b.items.length})</summary><ol>${b.items.map((r) => `<li value=${r.n}>${esc(r.text)}</li>`).join("")}</ol></details>`;
    case "index":
      return `<details>${pg}<summary>${esc(b.title)} (${b.lines.length} lines)</summary><pre>${esc(b.lines.join("\n"))}</pre></details>`;
    case "contents":
      return `<ol class=toc>${pg}${b.entries.map((e) => `<li>${e.num ? `<b>${esc(e.num)}</b> ` : ""}${esc(e.title)} <small>${esc(e.page)}</small></li>`).join("")}</ol>`;
  }
};
const html = `<!doctype html><meta charset=utf-8><title>${esc(book.title)}</title><style>
body{font:17px/1.6 Georgia,serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#222}
.pg{float:right;font:11px monospace;color:#999;margin-left:8px}.c{color:#06c;font-size:.7em}.x{color:#06c}.p{color:#a50}
figure{border:1px dashed #aaa;padding:.5rem;margin:1rem 0}.img{background:#eee;padding:1rem;font:12px monospace}
table{border-collapse:collapse;font:13px sans-serif;margin:.5rem 0;width:100%}td,th{border:1px solid #ccc;padding:3px 5px;vertical-align:top}
aside{background:#f4f1ea;padding:.6rem 1rem;margin:1rem 0}.call{background:#fdeee8}.small{font-size:.85em;color:#555}.tbl{margin:1rem 0}
</style><h1>${esc(book.title)}</h1><pre>${esc(JSON.stringify(book.stats))}</pre>${book.blocks.map(render).join("\n")}`;
fs.writeFileSync(path.join(outDir, "preview.html"), html);
console.log(JSON.stringify(book.stats));
console.log(`blocks ${book.blocks.length}, toc ${book.toc.length}, chapters ${book.chapters.length}`);
console.log(book.toc.filter((t) => t.level <= 2).map((t) => `${"  ".repeat(t.level - 1)}${t.title}  [p${t.page + 1}]`).join("\n"));
void blockText;
