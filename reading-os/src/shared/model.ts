// The structured, reflowable form of a book. The PDF extractor produces it,
// the reader renders it, and the AI features read from it. Every block keeps
// the page and rectangle it came from so the original page can always be shown.

/** Bump whenever extraction output changes so cached books are re-extracted. */
export const EXTRACTOR_VERSION = 20;

/** Rectangle in PDF points, origin at the top-left of the page. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Span {
  text: string;
  i?: boolean;
  b?: boolean;
  /** Superscript that is not a citation (e.g. exponents, footnote marks). */
  sup?: boolean;
  /** Subscript (e.g. "5-HT1B/1D", chemical formulas). */
  sub?: boolean;
  /** Inline program code, set in a typewriter font. */
  code?: boolean;
  /** Citation numbers pointing into the chapter's reference list. */
  cite?: number[];
  /** Cross-reference to a figure, table or box key, e.g. "Fig 1-1". */
  xref?: string;
  /** Zero-based page index for "see page 138" style references. */
  pageRef?: number;
}

interface BlockBase {
  id: string;
  /** Zero-based index of the PDF page where the block starts. */
  page: number;
  rect: Rect;
  /** Index into BookDoc.chapters. */
  chapter: number;
}

export interface HeadingBlock extends BlockBase {
  kind: "heading";
  level: 1 | 2 | 3 | 4;
  text: string;
  /** Chapter number shown above a level-1 heading, e.g. "2". */
  number?: string;
}

export interface ParagraphBlock extends BlockBase {
  kind: "paragraph";
  spans: Span[];
  /** Set for text noticeably smaller than body text (notes, sources). */
  small?: boolean;
}

export interface ListBlock extends BlockBase {
  kind: "list";
  ordered: boolean;
  items: Span[][];
}

export interface FigureBlock extends BlockBase {
  kind: "figure";
  /** "Fig 1-1"; absent for uncaptioned images. */
  key?: string;
  caption: Span[];
  /** Text found inside the figure (diagram labels), kept for search and AI. */
  labels?: string;
  /**
   * For books that aren't PDFs: the image itself, as a path inside the book's
   * archive (EPUB) or a data:/https: URL. PDF figures are cropped from the page.
   */
  image?: string;
}

export interface TablePart {
  page: number;
  rect: Rect;
}

export interface TableBlock extends BlockBase {
  kind: "table";
  key: string;
  caption: Span[];
  /** Cell text, row-major. The first `headerRows` rows are column headers. */
  rows: string[][];
  headerRows: number;
  /** Where the table sits in the original, possibly across several pages. */
  parts: TablePart[];
  notes: Span[][];
}

export interface BoxBlock extends BlockBase {
  kind: "box";
  key: string;
  title: Span[];
  body: (ParagraphBlock | ListBlock)[];
  parts: TablePart[];
}

/** Author-written highlights such as "Key Points" or "Learning Objectives". */
export interface CalloutBlock extends BlockBase {
  kind: "callout";
  title: string;
  items: Span[][];
}

export interface ReferenceEntry {
  n: number;
  text: string;
}

export interface ReferencesBlock extends BlockBase {
  kind: "references";
  title: string;
  items: ReferenceEntry[];
}

/** Back-of-book index or similar long lists, shown collapsed. */
export interface IndexBlock extends BlockBase {
  kind: "index";
  title: string;
  lines: string[];
}

/** The book's own table of contents page: entries with their printed page numbers. */
export interface ContentsBlock extends BlockBase {
  kind: "contents";
  entries: ContentsEntry[];
}

export interface ContentsEntry {
  /** Chapter number printed before the title, if any. */
  num?: string;
  title: string;
  /** The page label printed in the contents ("vi", "36"). */
  page: string;
  /** Chapter authors, in edited books ("Bailoor DN, Nagesh KS"). */
  authors?: string;
  /** A section listed under its chapter. */
  sub?: boolean;
}

/** The book's title pages, composed: title, subtitle, authors, edition, publisher. */
export interface TitlePageBlock extends BlockBase {
  kind: "titlepage";
  title: string;
  subtitle?: string;
  byline?: string;
  /** "Edited by" rather than "by". */
  edited?: boolean;
  edition?: string;
  publisher?: string;
  /** The rest of the title pages: affiliations, degrees, dedications. */
  details: string[];
  /** For books with image files (EPUB): the cover image. */
  cover?: string;
}

/** Everything in the opening pages that isn't read through — copyright, adverts,
 *  dedication, contributors, acknowledgements — kept, but folded into one place. */
export interface AboutBlock extends BlockBase {
  kind: "about";
  sections: { title: string; lines: string[] }[];
}

/** The copyright and cataloguing page(s): kept, but folded away. */
export interface ImprintBlock extends BlockBase {
  kind: "imprint";
  lines: string[];
}

/** Program code or other preformatted text, line by line. */
export interface CodeBlock extends BlockBase {
  kind: "code";
  lines: string[];
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | FigureBlock
  | TableBlock
  | BoxBlock
  | CalloutBlock
  | ReferencesBlock
  | IndexBlock
  | ContentsBlock
  | CodeBlock
  | ImprintBlock
  | TitlePageBlock
  | AboutBlock;

export interface PageInfo {
  w: number;
  h: number;
  /** The page number printed on the page ("vi", "36"), or the PDF index + 1. */
  label: string;
}

export interface TocEntry {
  id: string;
  title: string;
  level: number;
  blockId: string;
  page: number;
}

export interface Chapter {
  title: string;
  number?: string;
  /** Index of the first block of the chapter in BookDoc.blocks. */
  start: number;
  end: number;
  /** Citation number → reference text for this chapter. */
  refs: Record<number, string>;
}

export interface BookStats {
  bodySize: number;
  bodyFont: string;
  words: number;
  figures: number;
  tables: number;
  boxes: number;
  noiseRuns: number;
  ms: number;
}

export type BookFormat = "pdf" | "epub" | "docx" | "html" | "markdown" | "text";

export interface BookDoc {
  version: number;
  /** Absent in books extracted before other formats existed: those are PDFs. */
  format?: BookFormat;
  id: string;
  title: string;
  author?: string;
  fileName: string;
  pageCount: number;
  pages: PageInfo[];
  blocks: Block[];
  toc: TocEntry[];
  chapters: Chapter[];
  stats: BookStats;
}

export function spansText(spans: Span[]): string {
  return spans.map((s) => s.text).join("");
}

/** Plain text of a block, used for search, AI context and word counts. */
export function blockText(b: Block): string {
  switch (b.kind) {
    case "heading":
      return b.text;
    case "paragraph":
      return spansText(b.spans);
    case "list":
    case "callout":
      return b.items.map(spansText).join("\n");
    case "figure":
      return [b.key, spansText(b.caption)].filter(Boolean).join(" ");
    case "table":
      return [b.key, spansText(b.caption), ...b.rows.map((r) => r.join(" | "))].join("\n");
    case "box":
      return [b.key, spansText(b.title), ...b.body.map(blockText)].join("\n");
    case "references":
      return b.items.map((r) => `${r.n}. ${r.text}`).join("\n");
    case "index":
      return b.lines.join("\n");
    case "code":
    case "imprint":
      return b.lines.join("\n");
    case "about":
      return b.sections.map((s) => [s.title, ...s.lines].join("\n")).join("\n");
    case "titlepage":
      return [b.title, b.subtitle, b.byline, b.edition, b.publisher, ...b.details].filter(Boolean).join("\n");
    case "contents":
      return b.entries.map((e) => [e.num, e.title, e.page].filter(Boolean).join(" ")).join("\n");
  }
}
