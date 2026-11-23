import { strToU8, zipSync } from "fflate";
import { DOMParser } from "linkedom";
import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { blockText, type Block, type BookDoc } from "../model";
import { convertBook, detectFormat, resolvePath, type ConvertEnv } from "./index";

const env: ConvertEnv = {
  parse: (s, type) => new DOMParser().parseFromString(s, type === "application/xhtml+xml" ? "text/html" : type) as unknown as Document,
  markdownToHtml: (md) => marked.parse(md) as string,
};

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${body}</body></html>`;

function makeEpub(): Uint8Array {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Clinical Pain Handbook</dc:title><dc:creator>A. Author</dc:creator></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c0" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/fig1.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c0"/><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
    "OEBPS/nav.xhtml": strToU8(
      xhtml(`<nav epub:type="toc"><ol>
        <li><a href="text/ch1.xhtml">1. Assessment of Pain</a><ol><li><a href="text/ch1.xhtml#hist">History</a></li></ol></li>
        <li><a href="text/ch2.xhtml">2. Sleep and Pain</a></li></ol></nav>`),
    ),
    "OEBPS/text/cover.xhtml": strToU8(xhtml(`<p>Copyright 2024. All rights reserved.</p>`)),
    "OEBPS/text/ch1.xhtml": strToU8(
      xhtml(`<h2>Chapter 1</h2><h2>Assessment of Pain</h2>
        <p>Pain is assessed with a careful history. <em>Temporomandibular disorders</em> (TMDs) are common, see Figure 1.1.</p>
        <h3 id="hist">History</h3>
        <p>Ask about onset,<br/>duration and <strong>triggers</strong>.</p>
        <ul><li>Onset</li><li>Duration<ul><li>Days</li></ul></li></ul>
        <figure><img src="../images/fig1.png" alt="Jaw diagram" width="400" height="300"/><figcaption>Figure 1.1 The jaw joint.</figcaption></figure>
        <table><caption>Table 1.1 Pain scales</caption><thead><tr><th>Scale</th><th>Range</th></tr></thead><tbody><tr><td>VAS</td><td>0–100</td></tr></tbody></table>
        <aside><h4>Clinical tip</h4><p>Always ask about sleep.</p></aside>
        <aside epub:type="footnote" id="n1"><p>1. A footnote.</p></aside>`),
    ),
    "OEBPS/text/ch2.xhtml": strToU8(xhtml(`<div><p>Sleep and pain interact in both directions.</p><h3>Bruxism</h3><p>Grinding at night.</p></div>`)),
    "OEBPS/images/fig1.png": png,
  });
}

const kinds = (book: BookDoc) => book.blocks.map((b) => b.kind);
const find = <K extends Block["kind"]>(book: BookDoc, kind: K) => book.blocks.filter((b): b is Extract<Block, { kind: K }> => b.kind === kind);

describe("formats", () => {
  it("detects formats from bytes and names", () => {
    expect(detectFormat(makeEpub(), "book.epub")).toBe("epub");
    expect(detectFormat(strToU8("%PDF-1.7 ..."), "x.pdf")).toBe("pdf");
    expect(detectFormat(strToU8("# Title"), "notes.md")).toBe("markdown");
    expect(detectFormat(strToU8("<!DOCTYPE html><html>"), "page")).toBe("html");
    expect(detectFormat(strToU8("Plain words."), "a.txt")).toBe("text");
    expect(resolvePath("OEBPS/text/ch1.xhtml", "../images/a%20b.png")).toBe("OEBPS/images/a b.png");
  });

  it("reads an EPUB into chapters, sections, figures, tables and boxes", async () => {
    const { book, files } = await convertBook(makeEpub(), { id: "e1", fileName: "handbook.epub" }, env);
    expect(book.format).toBe("epub");
    expect(book.title).toBe("Clinical Pain Handbook");
    expect(book.author).toBe("A. Author");
    expect(book.pageCount).toBe(3);
    // Chapters follow the EPUB's table of contents; "Chapter 1" + title merge.
    const h1 = find(book, "heading").filter((h) => h.level === 1);
    expect(h1.map((h) => [h.number, h.text])).toEqual([
      ["1", "Assessment of Pain"],
      ["2", "Sleep and Pain"],
    ]);
    expect(book.chapters.map((c) => c.title)).toEqual(["Front matter", "Assessment of Pain", "Sleep and Pain"]);
    expect(find(book, "heading").find((h) => h.text === "History")?.level).toBe(2);
    const p = find(book, "paragraph").find((x) => blockText(x).startsWith("Pain is assessed"))!;
    expect(p.spans.some((s) => s.i && s.text === "Temporomandibular disorders")).toBe(true);
    expect(blockText(find(book, "paragraph").find((x) => blockText(x).startsWith("Ask"))!)).toBe("Ask about onset, duration and triggers.");
    expect(find(book, "list")[0].items.map((i) => i.map((s) => s.text).join(""))).toEqual(["Onset", "Duration", "Days"]);
    const fig = find(book, "figure")[0];
    expect(fig).toMatchObject({ key: "Fig 1-1", image: "OEBPS/images/fig1.png", labels: "Jaw diagram" });
    expect(files?.[fig.image!]).toBeTruthy();
    // "see Figure 1.1" links to the figure.
    expect(p.spans.some((s) => s.xref === "Fig 1-1")).toBe(true);
    const table = find(book, "table")[0];
    expect(table).toMatchObject({ key: "Table 1-1", headerRows: 1, rows: [["Scale", "Range"], ["VAS", "0–100"]] });
    expect(find(book, "box")[0].title[0].text).toBe("Clinical tip");
    expect(find(book, "paragraph").find((x) => blockText(x) === "1. A footnote.")?.small).toBe(true);
    expect(new Set(book.blocks.map((b) => b.id)).size).toBe(book.blocks.length);
    expect(book.toc.map((t) => t.title)).toContain("1. Assessment of Pain");
    expect(kinds(book)).not.toContain("contents");
  });

  it("reads Markdown and HTML", async () => {
    const md = await convertBook(strToU8("# Notes on Pain\n\nSome *italic* text.\n\n## Part A\n\n- one\n- two\n"), { id: "m", fileName: "notes.md" }, env);
    expect(md.book.title).toBe("Notes on Pain");
    expect(kinds(md.book)).toEqual(["heading", "paragraph", "heading", "list"]);
    const html = await convertBook(
      strToU8(`<!doctype html><html><head><title>Article</title></head><body><nav>menu</nav><article><h1>Big</h1><p>Body text.</p><img src="pic.png"></article><script>x()</script></body></html>`),
      { id: "h", fileName: "a.html" },
      env,
    );
    expect(html.book.title).toBe("Article");
    expect(html.book.blocks.map(blockText)).toEqual(["Big", "Body text."]); // nav, scripts and unreachable images are left out
  });

  it("reads plain text, joining wrapped lines and finding chapters", async () => {
    const txt = [
      "The Project Gutenberg eBook of A Tale",
      "Title: A Tale",
      "Author: Someone",
      "*** START OF THE PROJECT GUTENBERG EBOOK A TALE ***",
      "",
      "CHAPTER I",
      "",
      "THE BEGINNING",
      "",
      "It was a dark and stormy night; the rain fell in tor-",
      "rents, except at occasional intervals.",
      "",
      "A second paragraph.",
      "",
      "CHAPTER II",
      "",
      "More text here.",
      "*** END OF THE PROJECT GUTENBERG EBOOK A TALE ***",
      "License text that should not appear.",
    ].join("\n");
    const { book } = await convertBook(strToU8(txt), { id: "t", fileName: "tale.txt" }, env);
    expect(book.title).toBe("A Tale");
    expect(book.author).toBe("Someone");
    const hs = find(book, "heading");
    expect(hs.map((h) => [h.level, h.number, h.text])).toEqual([
      [1, "I", "The Beginning"],
      [1, undefined, "Chapter II"],
    ]);
    expect(blockText(find(book, "paragraph")[0])).toBe("It was a dark and stormy night; the rain fell in torrents, except at occasional intervals.");
    expect(book.blocks.map(blockText).join(" ")).not.toContain("License");
  });

  it("explains files it can't open", async () => {
    await expect(convertBook(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), { id: "z", fileName: "a.zip" }, env)).rejects.toThrow(/can't be opened/);
  });
});
