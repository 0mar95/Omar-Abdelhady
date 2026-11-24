// Books that aren't PDFs: EPUB, Word, web pages, Markdown and plain text.
// Each becomes the same BookDoc the PDF extractor produces, so every reading
// and AI feature works the same on them. Only the "original pages" view is
// PDF-only.

import { unzipSync } from "fflate";
import { EXTRACTOR_VERSION, blockText, type Block, type BookDoc, type BookFormat, type PageInfo } from "../model.ts";
import { assignChapters, buildToc, linkReferences } from "../pdf/analyze.ts";
import { countWords } from "../pdf/text.ts";
import { bookTitle, normalizeStructure, placeFigures } from "../normalize.ts";
import { HtmlConverter, normalizeHeadings } from "./html.ts";
import { textToBlocks } from "./text.ts";

/** DOMParser in the app; linkedom in tests and the command-line extractor. */
export type ParseDoc = (source: string, type: "text/html" | "application/xhtml+xml" | "text/xml") => Document;

export interface ConvertEnv {
  parse: ParseDoc;
  /** Word → HTML (mammoth), loaded only when a Word file is opened. */
  docxToHtml?(bytes: Uint8Array): Promise<string>;
  /** Markdown → HTML (marked). */
  markdownToHtml?(md: string): string | Promise<string>;
}

export interface ConvertMeta {
  id: string;
  fileName: string;
}

export interface Converted {
  book: BookDoc;
  /** Files inside the book's archive (EPUB), for its images. */
  files?: Record<string, Uint8Array>;
}

export const BOOK_EXTENSIONS = ["pdf", "epub", "docx", "html", "htm", "xhtml", "md", "markdown", "txt"];

/** What kind of book these bytes are, from their first bytes and the file name. */
export function detectFormat(bytes: Uint8Array, fileName: string): BookFormat | null {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
  if (head.includes("%PDF-")) return "pdf";
  if (head.startsWith("PK\u0003\u0004")) {
    if (head.includes("mimetypeapplication/epub+zip") || ext === "epub") return "epub";
    if (head.includes("word/") || head.includes("[Content_Types].xml") || ext === "docx") return ext === "epub" ? "epub" : "docx";
    return null;
  }
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm" || ext === "xhtml" || /^\s*(<!doctype html|<html)/i.test(head.replace(/^﻿/, ""))) return "html";
  if (ext === "txt" || ext === "text" || !/[\u0000-\u0008\u000e-\u001f]/.test(head)) return "text";
  return null;
}

export async function convertBook(bytes: Uint8Array, meta: ConvertMeta, env: ConvertEnv): Promise<Converted> {
  const format = detectFormat(bytes, meta.fileName);
  const started = Date.now();
  switch (format) {
    case "epub":
      return convertEpub(bytes, meta, env, started);
    case "docx": {
      if (!env.docxToHtml) throw new Error("Word documents aren't supported here");
      const html = await env.docxToHtml(bytes);
      const doc = env.parse(`<!doctype html><html><body>${html}</body></html>`, "text/html");
      const conv = new HtmlConverter();
      conv.convert(doc.body, { page: 0, resolveImage: (src) => (/^data:image\//.test(src) ? src : undefined) });
      return { book: finish(conv.blocks, [page()], meta, "docx", docxTitle(bytes, env), undefined, started) };
    }
    case "html": {
      const doc = env.parse(decodeText(bytes), "text/html");
      const conv = new HtmlConverter();
      conv.convert(doc.body, { page: 0, resolveImage: webImage });
      const title = doc.querySelector("title")?.textContent?.trim();
      return { book: finish(conv.blocks, [page()], meta, "html", title, metaContent(doc, "author"), started) };
    }
    case "markdown": {
      if (!env.markdownToHtml) throw new Error("Markdown isn't supported here");
      const html = await env.markdownToHtml(decodeText(bytes));
      const doc = env.parse(`<!doctype html><html><body>${html}</body></html>`, "text/html");
      const conv = new HtmlConverter();
      conv.convert(doc.body, { page: 0, resolveImage: webImage });
      return { book: finish(conv.blocks, [page()], meta, "markdown", undefined, undefined, started) };
    }
    case "text": {
      const { blocks, title, author } = textToBlocks(decodeText(bytes));
      return { book: finish(blocks, [page()], meta, "text", title, author, started) };
    }
    default:
      throw new Error("This file type can't be opened. Kenning opens PDF, EPUB, Word (.docx), HTML, Markdown and text files.");
  }
}

const page = (): PageInfo => ({ w: 0, h: 0, label: "" });

/**
 * Only images embedded in the file itself: nothing is fetched from the web
 * (the reader never contacts other servers), and relative paths to files
 * beside a web page can't be reached.
 */
const webImage = (src: string) => (/^data:image\//.test(src) ? src : undefined);

function finish(
  raw: Block[],
  pages: PageInfo[],
  meta: ConvertMeta,
  format: BookFormat,
  title: string | undefined,
  author: string | undefined,
  started: number,
): BookDoc {
  normalizeHeadings(raw);
  let blocks = normalizeStructure(raw);
  linkReferences(blocks, pages);
  blocks = placeFigures(blocks);
  const chapters = assignChapters(blocks);
  const toc = buildToc(blocks);
  let words = 0;
  for (const b of blocks) words += countWords(blockText(b));
  const firstHeading = blocks.find((b) => b.kind === "heading");
  return {
    version: EXTRACTOR_VERSION,
    format,
    id: meta.id,
    title: bookTitle(blocks, title) || (firstHeading?.kind === "heading" && firstHeading.text.length < 90 ? firstHeading.text : titleFromFile(meta.fileName)),
    author: author?.trim() || undefined,
    fileName: meta.fileName,
    pageCount: pages.length,
    pages,
    blocks,
    toc,
    chapters,
    stats: {
      bodySize: 0,
      bodyFont: "",
      words,
      figures: blocks.filter((b) => b.kind === "figure").length,
      tables: blocks.filter((b) => b.kind === "table").length,
      boxes: blocks.filter((b) => b.kind === "box").length,
      noiseRuns: 0,
      ms: Date.now() - started,
    },
  };
}

function titleFromFile(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_]+/g, " ")
    .trim();
}

/** UTF-8 (with or without BOM), UTF-16 with BOM, or Windows-1252 for old text files. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function metaContent(doc: Document, name: string): string | undefined {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? undefined;
}

function docxTitle(bytes: Uint8Array, env: ConvertEnv): string | undefined {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === "docProps/core.xml" });
    const core = files["docProps/core.xml"];
    if (!core) return undefined;
    const doc = env.parse(decodeText(core), "text/xml");
    return byName(doc, "title")[0]?.textContent?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// ---------- EPUB ----------

/** Elements by local name, whatever namespace prefix the file uses ("dc:title"). */
function byName(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const visit = (el: Element) => {
    const n = (el.localName || el.nodeName).toLowerCase();
    if (n === name || n.endsWith(`:${name}`)) out.push(el);
    for (const c of Array.from(el.children)) visit(c);
  };
  const start = "documentElement" in root ? root.documentElement : root;
  if (start) visit(start);
  return out;
}

/** Resolves a relative href against the archive path of the file that contains it. */
export function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponentSafe(href.split("#")[0]);
  if (!clean) return base;
  const parts = (clean.startsWith("/") ? [] : base.split("/").slice(0, -1)).concat(clean.replace(/^\//, "").split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

interface NavEntry {
  title: string;
  target: string; // "OEBPS/ch1.xhtml" or "OEBPS/ch1.xhtml#sec2"
  depth: number;
}

function convertEpub(bytes: Uint8Array, meta: ConvertMeta, env: ConvertEnv, started: number): Converted {
  const files = unzipSync(bytes);
  const text = (p: string) => (files[p] ? decodeText(files[p]) : null);
  const container = text("META-INF/container.xml");
  if (!container) throw new Error("This EPUB is missing its table of files (META-INF/container.xml).");
  const rootPath = byName(env.parse(container, "text/xml"), "rootfile")[0]?.getAttribute("full-path");
  const opfText = rootPath ? text(rootPath) : null;
  if (!rootPath || !opfText) throw new Error("This EPUB's package file couldn't be found.");
  if (files["META-INF/encryption.xml"] && /EncryptedData/.test(text("META-INF/encryption.xml") ?? "") && !/obfuscation/i.test(text("META-INF/encryption.xml") ?? "")) {
    throw new Error("This EPUB is copy-protected (DRM), so it can't be opened.");
  }
  const opf = env.parse(opfText, "text/xml");

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of byName(opf, "item")) {
    const id = it.getAttribute("id");
    const href = it.getAttribute("href");
    if (id && href) manifest.set(id, { href: resolvePath(rootPath, href), type: it.getAttribute("media-type") ?? "", props: it.getAttribute("properties") ?? "" });
  }
  const spineEl = byName(opf, "spine")[0];
  const spine = byName(opf, "itemref")
    .map((r) => manifest.get(r.getAttribute("idref") ?? ""))
    .filter((m): m is { href: string; type: string; props: string } => !!m && /html|xml/.test(m.type) && !!files[m.href]);
  const title = byName(opf, "title")[0]?.textContent?.trim();
  const author = byName(opf, "creator")
    .map((c) => c.textContent?.trim())
    .filter(Boolean)
    .join(", ");

  // Table of contents: EPUB 3 nav document, or the EPUB 2 NCX.
  let nav: NavEntry[] = [];
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  if (navItem && files[navItem.href]) nav = readNav(env.parse(text(navItem.href)!, "application/xhtml+xml"), navItem.href, env);
  if (!nav.length) {
    const ncx = manifest.get(spineEl?.getAttribute("toc") ?? "") ?? [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
    if (ncx && files[ncx.href]) nav = readNcx(env.parse(text(ncx.href)!, "text/xml"), ncx.href);
  }

  const conv = new HtmlConverter();
  const starts: number[] = [];
  spine.forEach((item, i) => {
    starts.push(conv.blocks.length);
    const src = text(item.href) ?? "";
    let doc = env.parse(src, "application/xhtml+xml");
    if (!doc.documentElement || doc.getElementsByTagName("parsererror").length || !bodyOf(doc)) doc = env.parse(src, "text/html");
    const body = bodyOf(doc);
    if (!body) return;
    conv.convert(
      body,
      {
        page: i,
        resolveImage: (s) => {
          if (/^data:image\//.test(s)) return s;
          const p = resolvePath(item.href, s);
          return files[p] ? p : undefined;
        },
      },
      item.href,
    );
  });

  // Chapters follow the book's own table of contents: each top-level entry
  // starts at a level-1 heading (an existing heading is promoted, or the
  // entry's title is added).
  normalizeHeadings(conv.blocks);
  const blocks = conv.blocks;
  const top = nav.filter((n) => n.depth === 0);
  const targets = new Map<string, NavEntry>();
  for (const n of top) {
    const id = conv.anchors.get(n.target) ?? conv.anchors.get(n.target.split("#")[0]);
    if (id && !targets.has(id)) targets.set(id, n);
  }
  if (targets.size >= 2) {
    const out: Block[] = [];
    let added = 0;
    for (const b of blocks) {
      const n = targets.get(b.id);
      if (n) {
        if (b.kind === "heading") b.level = 1;
        else {
          out.push({ kind: "heading", id: `${b.id}h`, page: b.page, rect: b.rect, chapter: 0, level: 1, text: n.title });
          added++;
        }
      } else if (b.kind === "heading" && b.level === 1) b.level = 2;
      out.push(b);
    }
    blocks.splice(0, blocks.length, ...out);
    void added;
  }
  const pages: PageInfo[] = spine.map(() => page());
  // finish() normalizes again; levels 1–4 map onto themselves when all are used.
  return { book: finish(blocks, pages, meta, "epub", title, author, started), files };
}

function bodyOf(doc: Document): Element | null {
  return doc.body ?? doc.getElementsByTagName("body")[0] ?? null;
}

function readNav(doc: Document, base: string, env: ConvertEnv): NavEntry[] {
  void env;
  const navs = byName(doc, "nav");
  const toc = navs.find((n) => /\btoc\b/.test(n.getAttribute("epub:type") ?? n.getAttribute("type") ?? "")) ?? navs[0];
  const ol = toc ? Array.from(toc.children).find((c) => /^(ol|ul)$/i.test(c.localName)) : undefined;
  const out: NavEntry[] = [];
  const walk = (list: Element, depth: number) => {
    for (const li of Array.from(list.children)) {
      const a = Array.from(li.children).find((c) => /^(a|span)$/i.test(c.localName));
      const href = a?.getAttribute("href");
      if (a && href) {
        const frag = href.includes("#") ? `#${href.split("#")[1]}` : "";
        out.push({ title: (a.textContent ?? "").replace(/\s+/g, " ").trim(), target: resolvePath(base, href) + frag, depth });
      }
      const sub = Array.from(li.children).find((c) => /^(ol|ul)$/i.test(c.localName));
      if (sub) walk(sub, depth + 1);
    }
  };
  if (ol) walk(ol, 0);
  return out;
}

function readNcx(doc: Document, base: string): NavEntry[] {
  const out: NavEntry[] = [];
  const walk = (el: Element, depth: number) => {
    for (const np of Array.from(el.children).filter((c) => /navpoint$/i.test(c.localName || c.nodeName))) {
      const label = byName(np, "text")[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const src = byName(np, "content")[0]?.getAttribute("src");
      if (src) {
        const frag = src.includes("#") ? `#${src.split("#")[1]}` : "";
        out.push({ title: label, target: resolvePath(base, src) + frag, depth });
      }
      walk(np, depth + 1);
    }
  };
  const map = byName(doc, "navmap")[0];
  if (map) walk(map, 0);
  return out;
}
