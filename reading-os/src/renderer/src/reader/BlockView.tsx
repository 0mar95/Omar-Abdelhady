// Renders one book block. Interactive bits (citations, figure links, page
// links) are plain elements with data attributes; Reader handles hover and
// clicks for all of them with a few delegated listeners.

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import type { AboutBlock, Block, BoxBlock, HeadingBlock, FigureBlock, Span, TableBlock, TitlePageBlock } from "../../../shared/model";
import { useCover } from "../covers";
import { useHighlights, type Highlight } from "../state/highlights";
import { formatMinutes, outlineOf } from "./outline";
import type { TermMatch } from "../../../shared/glossary/extract";
import { imageUrl } from "../formats";
import { renderRegion } from "../pdf";
import { useGlossary } from "../state/glossary";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconBulb, IconImage } from "../ui/icons";

const URL_RE = /(https?:\/\/[^\s)]+[^\s).,;])/g;

function linkify(text: string, key: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <a key={`${key}u${i++}`} className="ext" href={m[0]} target="_blank" rel="noreferrer">
        {m[0]}
      </a>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Wraps the first mention of each glossary term (per block) for hover definitions. */
/** Per-block marking state: terms allowed here, and those already marked. */
export interface TermMarks {
  allow: Set<string>;
  done: Set<string>;
}

function markTerms(text: string, match: (t: string) => TermMatch[], marks: TermMarks, key: string): ReactNode {
  const hits = match(text).filter((m) => marks.allow.has(m.key) && !marks.done.has(m.key));
  if (!hits.length) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const h of hits) {
    if (marks.done.has(h.key)) continue;
    marks.done.add(h.key);
    if (h.start > last) out.push(text.slice(last, h.start));
    out.push(
      <span key={`${key}t${h.start}`} className="term" data-term={h.key}>
        {text.slice(h.start, h.end)}
      </span>,
    );
    last = h.end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Spans({ spans, chapter, seen }: { spans: Span[]; chapter: number; seen?: TermMarks }) {
  const match = useGlossary((g) => g.match);
  const enabled = useSettings((st) => st.glossaryMarks);
  const mark = enabled && match && seen && seen.allow.size ? match : null;
  return (
    <>
      {spans.map((s, i) => {
        if (s.cite)
          return (
            <sup key={i} className="cite" data-cite={s.cite.join(",")} data-chapter={chapter} role="doc-noteref">
              {s.text}
            </sup>
          );
        const plain = !s.xref && s.pageRef === undefined && !s.sup && !s.sub && !s.code;
        let node: ReactNode = s.text.includes("http") ? linkify(s.text, String(i)) : mark && plain ? markTerms(s.text, mark, seen!, String(i)) : s.text;
        if (s.sup) node = <sup>{node}</sup>;
        if (s.sub) node = <sub>{node}</sub>;
        if (s.code) node = <code className="inline-code">{node}</code>;
        if (s.i) node = <em>{node}</em>;
        if (s.b) node = <strong>{node}</strong>;
        if (s.xref)
          return (
            <span key={i} className="xref" data-xref={s.xref}>
              {node}
            </span>
          );
        if (s.pageRef !== undefined)
          return (
            <span key={i} className="pageref" data-page={s.pageRef}>
              {node}
            </span>
          );
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

/** A figure's own image (EPUB, Word): loaded lazily, shown at its natural size or the column width. */
export function BookImage({ image, alt, className, maxWidth }: { image: string; alt: string; className?: string; maxWidth?: number }) {
  const src = imageUrl(image);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`block h-auto max-w-full rounded-[3px] ${className ?? ""}`}
      style={maxWidth ? { maxWidth } : undefined}
    />
  );
}

/** A figure image from either source: the book's own image, or a crop of the PDF page. */
export function FigureImage({ b, maxWidth, className }: { b: FigureBlock; maxWidth?: number; className?: string }) {
  const alt = b.labels ?? b.key ?? "Figure";
  return b.image ? (
    <BookImage image={b.image} alt={alt} maxWidth={maxWidth} className={`mx-auto ${className ?? ""}`} />
  ) : (
    <PageCrop page={b.page} rect={b.rect} alt={alt} maxWidth={maxWidth} className={className ?? "mx-auto"} />
  );
}

/** Renders a region of the original page as an image, only once it scrolls near. */
export function PageCrop({
  page,
  rect,
  alt,
  className,
  maxWidth,
  scale = 1.45,
}: {
  page: number;
  rect: Block["rect"];
  alt: string;
  className?: string;
  maxWidth?: number;
  scale?: number;
}) {
  const doc = useReader((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  // Show figures a little larger than their printed size, as screens are read further away.
  const displayW = Math.min(maxWidth ?? 820, w * scale);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !doc) return;
    let alive = true;
    renderRegion(doc, page, rect, displayW * 1.5)
      .then((u) => alive && setSrc(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [near, doc, page, rect, displayW]);
  return (
    <div ref={ref} className={className} style={{ width: "100%", maxWidth: displayW, aspectRatio: `${w} / ${h}` }}>
      {src ? (
        <img src={src} alt={alt} className="block h-full w-full rounded-[3px] object-contain" draggable={false} />
      ) : (
        <div className="grid h-full w-full place-items-center rounded-[3px] bg-paper-2 text-ink-3">
          <IconImage size={22} />
        </div>
      )}
    </div>
  );
}

function Figure({ b }: { b: FigureBlock }) {
  const setZoom = useZoom((s) => s.set);
  return (
    <figure className="my-8 flex flex-col items-center" data-key={b.key}>
      <button
        type="button"
        className="w-full cursor-zoom-in rounded-md bg-[var(--figure-bg)] p-2 shadow-[0_0_0_1px_var(--rule)]"
        onClick={() => setZoom({ page: b.page, rect: b.rect, title: b.key ?? "Figure", image: b.image, caption: stripKey(b.caption, b.key), chapter: b.chapter })}
        aria-label={`Enlarge ${b.key ?? "figure"}`}
      >
        <FigureImage b={b} />
      </button>
      {(b.key || b.caption.length > 0) && (
        <figcaption className="mt-3 w-full font-ui text-[0.8em] leading-snug text-ink-2">
          {b.key && <span className="mr-1.5 font-semibold text-accent">{b.key}</span>}
          <Spans spans={stripKey(b.caption, b.key)} chapter={b.chapter} />
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The caption without its own label, however the book spells it: the key
 * "Fig 1-22" matches "Fig. 1.22", "Figure 1–22:", "FIG 1-22" (across styled spans too).
 */
export function stripKey(spans: Span[], key?: string): Span[] {
  if (!key || !spans.length) return spans;
  const nums = key.match(/\d+/g);
  if (!nums) return spans;
  const text = spans.map((s) => s.text).join("");
  const re = new RegExp(`^\\s*(?:fig(?:ure)?|table|box|plate|chart)?s?\\.?\\s*${nums.join("\\s*[-.–—]\\s*")}(?!\\d)\\s*[.:–—-]?\\s*`, "i");
  const m = re.exec(text);
  if (!m) return spans;
  let cut = m[0].length;
  const out: Span[] = [];
  for (const s of spans) {
    if (cut >= s.text.length) {
      cut -= s.text.length;
      continue;
    }
    out.push(cut ? { ...s, text: s.text.slice(cut) } : s);
    cut = 0;
  }
  return out;
}

/** The table itself: header row stays put while the body scrolls; the first column too, when wide. */
export function TableGrid({ b, full }: { b: TableBlock; full?: boolean }) {
  const head = b.rows.slice(0, b.headerRows);
  const body = b.rows.slice(b.headerRows);
  const wide = Math.max(0, ...b.rows.map((r) => r.length)) >= 5;
  return (
    <div className={`table-box scroll-quiet ${full ? "full" : ""} ${wide ? "wide" : ""}`}>
      <table>
        {head.length > 0 && (
          <thead>
            {head.map((r, i) => (
              <tr key={i}>
                {r.map((c, k) => (
                  <th key={k}>{c}</th>
                ))}
              </tr>
            ))}
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, k) => (
                <td key={k}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Table({ b }: { b: TableBlock }) {
  const [original, setOriginal] = useState(b.rows.length === 0);
  const setZoom = useZoom((s) => s.set);
  const expand = () => setZoom({ page: b.page, rect: b.rect, title: b.key, table: b });
  return (
    <div className="my-8 font-ui" data-key={b.key}>
      <div className="mb-2 flex items-baseline gap-2 text-[0.82em] leading-snug">
        <span className="shrink-0 font-semibold text-accent">{b.key}</span>
        <span className="text-ink-2">
          <Spans spans={b.caption} chapter={b.chapter} />
        </span>
        <span className="ml-auto flex shrink-0 gap-1.5">
          {b.rows.length > 0 && b.parts.length > 0 && (
            <button type="button" onClick={() => setOriginal((v) => !v)} className="table-chip">
              {original ? "Reflowed" : "As printed"}
            </button>
          )}
          {!original && b.rows.length > 0 && (
            <button type="button" onClick={expand} className="table-chip" title="Open the table full screen">
              Expand
            </button>
          )}
        </span>
      </div>
      {original ? (
        <div className="flex flex-col items-center gap-2 rounded-md bg-[var(--figure-bg)] p-2 shadow-[0_0_0_1px_var(--rule)]">
          {b.parts.map((p, i) => (
            <PageCrop key={i} page={p.page} rect={p.rect} alt={`${b.key} (original)`} maxWidth={900} />
          ))}
        </div>
      ) : (
        <TableGrid b={b} />
      )}
      {b.notes.length > 0 && (
        <div className="mt-2 space-y-1 text-[0.72em] leading-snug text-ink-3">
          {b.notes.map((n, i) => (
            <p key={i} className="!m-0 !text-left">
              <Spans spans={n} chapter={b.chapter} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Box({ b }: { b: BoxBlock }) {
  const allow = useGlossary((g) => g.allowed.get(b.id));
  const seen: TermMarks = { allow: allow ?? EMPTY, done: new Set() };
  return (
    <aside className="my-8 rounded-lg bg-accent-soft/60 px-5 py-4 text-[0.9em] shadow-[inset_3px_0_0_var(--accent)]" data-key={b.key}>
      <div className="mb-2 font-ui text-[0.85em] leading-snug">
        <span className="mr-2 font-semibold text-accent">{b.key}</span>
        <span className="font-semibold text-ink">
          <Spans spans={b.title} chapter={b.chapter} />
        </span>
      </div>
      {b.body.map((x) =>
        x.kind === "list" ? (
          <ul key={x.id} className="!mb-2">
            {x.items.map((it, i) => (
              <li key={i}>
                <Spans spans={it} chapter={b.chapter} seen={seen} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={x.id} className={`!mb-2 !text-left ${x.small ? "small" : ""}`}>
            <Spans spans={x.spans} chapter={b.chapter} seen={seen} />
          </p>
        ),
      )}
    </aside>
  );
}

const EMPTY = new Set<string>();


/**
 * Every book opens the same way: cover, title, subtitle, authors, edition and
 * publisher, composed — whatever its title pages looked like.
 */
export function TitlePage({ b }: { b: Pick<TitlePageBlock, "title" | "subtitle" | "byline" | "edited" | "edition" | "publisher" | "details"> }) {
  const book = useReader((s) => s.book)!;
  const cover = useCover(book.id);
  const title = b.title || book.title;
  const byline = b.byline || book.author;
  const meta = [b.edition, b.publisher].filter(Boolean).join(" · ");
  return (
    <header className="title-page font-ui">
      {cover && <img src={cover} alt="" className="cover" draggable={false} />}
      <h1 className="title">{title}</h1>
      {b.subtitle && <p className="subtitle">{b.subtitle}</p>}
      <span className="rule" aria-hidden />
      {byline && (
        <p className="byline">
          {b.edited && <span className="label">Edited by</span>}
          {byline.split(/\s*\|\s*/).join(" · ")}
        </p>
      )}
      {meta && <p className="meta">{meta}</p>}
      {b.details.length > 0 && (
        <details className="more">
          <summary>From the title page</summary>
          {b.details.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
        </details>
      )}
    </header>
  );
}

/** For books without a contents page of their own: the chapters, one click away. */
/** Kenning's own contents: chapters and their sections, with reading times, no page numbers. */
export function ChapterList() {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const outline = outlineOf(book, ix);
  const chapters = book.chapters.filter((c) => c.title !== "Front matter" && book.blocks[c.start]?.kind === "heading");
  if (chapters.length < 2) return null;
  const go = (id: string) => useReader.getState().jumpTo({ blockId: id });
  return (
    <nav aria-label="Contents" className="book-contents mb-16 font-ui">
      <h2 className="!mt-0">Contents</h2>
      <ol>
        {chapters.map((c, i) => {
          const head = book.blocks[c.start];
          const o = outline.byHeading.get(head.id);
          const sections = book.toc.filter((t) => t.level === 2 && (ix.byId.get(t.blockId) ?? -1) > c.start && (ix.byId.get(t.blockId) ?? -1) < c.end);
          return (
            <li key={i}>
              <button type="button" className="chapter-row" onClick={() => go(head.id)}>
                <span className="num">{c.number}</span>
                <span className="title">{c.title}</span>
                {o && <span className="time">{o.minutes} min</span>}
              </button>
              {sections.length > 0 && sections.length <= 40 && (
                <ol className="sections">
                  {sections.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => go(t.blockId)}>
                        {t.title}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The opening pages that aren't read through, folded into one place. */
function About({ b }: { b: AboutBlock }) {
  return (
    <details className="group my-8 rounded-lg border border-rule font-ui">
      <summary className="cursor-pointer list-none px-4 py-3 text-[0.8em] font-semibold text-ink-2 hover:text-ink">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
        About this book <span className="font-normal text-ink-3">· {b.sections.map((x) => x.title.toLowerCase()).join(", ")}</span>
      </summary>
      <div className="space-y-4 border-t border-rule px-4 py-3 text-[0.72em] leading-snug text-ink-2">
        {b.sections.map((sec, i) => (
          <section key={i}>
            <h4 className="!m-0 !mb-1 text-[1em] font-semibold text-ink">{sec.title}</h4>
            {sec.lines.map((l, k) => (
              <p key={k} className="!m-0 !text-left">
                {l}
              </p>
            ))}
          </section>
        ))}
      </div>
    </details>
  );
}

/** A chapter's first page: number, title, authors, reading time, key points and sections. */
function ChapterOpener({ b }: { b: HeadingBlock }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const o = outlineOf(book, ix).byHeading.get(b.id);
  return (
    <header className="chapter-opener">
      {b.number && <div className="num">{b.number}</div>}
      <h1 id={b.id}>{b.text}</h1>
      {o?.authors && <p className="authors">{o.authors}</p>}
      {o && (
        <p className="meta">
          {formatMinutes(o.minutes)}
          {o.sections.length > 0 && ` · ${o.sections.length} sections`}
        </p>
      )}
      {o?.keyPoints && (
        <aside className="key-points">
          <div className="label">
            <IconBulb size={15} /> {o.keyPoints.title}
          </div>
          <ul>
            {o.keyPoints.items.map((it, i) => (
              <li key={i}>
                <Spans spans={it} chapter={b.chapter} />
              </li>
            ))}
          </ul>
        </aside>
      )}
      {o && o.sections.length > 0 && (
        <nav className="in-chapter" aria-label="In this chapter">
          <div className="label">In this chapter</div>
          <ol>
            {o.sections.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => useReader.getState().jumpTo({ blockId: s.id })}>
                  {s.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </header>
  );
}

function BlockInner({ b }: { b: Block }) {
  // Glossary terms are marked at their first mention in each section.
  const allow = useGlossary((g) => g.allowed.get(b.id));
  const seen: TermMarks = { allow: allow ?? EMPTY, done: new Set() };
  switch (b.kind) {
    case "heading":
      if (b.level === 1) return <ChapterOpener b={b} />;
      if (b.level === 2) return <h2 id={b.id}>{b.text}</h2>;
      if (b.level === 3) return <h3 id={b.id}>{b.text}</h3>;
      return <h4 id={b.id}>{b.text}</h4>;
    case "paragraph":
      return (
        <p className={b.small ? "small" : undefined}>
          <Spans spans={b.spans} chapter={b.chapter} seen={seen} />
        </p>
      );
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>
          <Spans spans={it} chapter={b.chapter} seen={seen} />
        </li>
      ));
      return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "figure":
      return <Figure b={b} />;
    case "table":
      return <Table b={b} />;
    case "box":
      return <Box b={b} />;
    case "callout":
      return (
        <aside className="mb-10 rounded-xl border border-rule bg-card px-6 py-5 font-ui shadow-[var(--shadow)]">
          <div className="mb-3 flex items-center gap-2 text-[0.75em] font-semibold uppercase tracking-[0.08em] text-accent">
            <IconBulb size={16} /> {b.title}
          </div>
          <ul className="!m-0 space-y-2 !pl-5 text-[0.86em] leading-relaxed text-ink-2">
            {b.items.map((it, i) => (
              <li key={i}>
                <Spans spans={it} chapter={b.chapter} seen={seen} />
              </li>
            ))}
          </ul>
        </aside>
      );
    case "references":
      return (
        <details className="group my-10 rounded-lg border border-rule font-ui">
          <summary className="cursor-pointer list-none px-4 py-3 text-[0.8em] font-semibold text-ink-2 hover:text-ink">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
            {b.title} <span className="font-normal text-ink-3">· {b.items.length}</span>
          </summary>
          <ol className="!mb-0 space-y-1.5 border-t border-rule px-4 py-3 !pl-10 text-[0.72em] leading-snug text-ink-2">
            {b.items.map((r, i) => (
              <li key={i} value={r.n || undefined} id={`ref-${b.chapter}-${r.n}`} className="scroll-mt-24">
                {r.text}
              </li>
            ))}
          </ol>
        </details>
      );
    case "index":
      return (
        <details className="group my-10 rounded-lg border border-rule font-ui">
          <summary className="cursor-pointer list-none px-4 py-3 text-[0.8em] font-semibold text-ink-2 hover:text-ink">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
            {b.title} <span className="font-normal text-ink-3">· use ⌘K to search the book</span>
          </summary>
          <div className="columns-2 gap-6 border-t border-rule px-4 py-3 text-[0.7em] leading-snug text-ink-2">
            {b.lines.map((l, i) => (
              <div key={i} className="break-inside-avoid">
                {l}
              </div>
            ))}
          </div>
        </details>
      );
    case "contents":
      // The printed contents page: Kenning shows its own contents instead.
      return null;
    case "about":
      return <About b={b} />;
    case "titlepage":
      return <TitlePage b={b} />;
    case "imprint":
      return (
        <details className="group my-8 rounded-lg border border-rule font-ui">
          <summary className="cursor-pointer list-none px-4 py-3 text-[0.8em] font-semibold text-ink-2 hover:text-ink">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
            Publication details <span className="font-normal text-ink-3">· copyright, ISBN, cataloguing</span>
          </summary>
          <div className="space-y-1.5 border-t border-rule px-4 py-3 text-[0.72em] leading-snug text-ink-2">
            {b.lines.map((l, i) => (
              <p key={i} className="!m-0">
                {l}
              </p>
            ))}
          </div>
        </details>
      );
    case "code":
      return (
        <pre className="scroll-quiet my-5 overflow-x-auto rounded-lg bg-paper-2 px-4 py-3 font-mono text-[0.78em] leading-relaxed text-ink ring-1 ring-rule/60">
          <code>{b.lines.join("\n")}</code>
        </pre>
      );
  }
}

/** flow: "jp" when a paragraph follows a paragraph, "jn" when one comes next (book-style indents). */
export const BlockView = memo(function BlockView({ b, pageLabel, flow, marks }: { b: Block; pageLabel?: string; flow?: string; marks?: Highlight[] }) {
  return (
    <>
      {marks && marks.length > 0 && <HighlightMark marks={marks} />}
      {pageLabel && (
        // A zero-height sibling: blocks clip their own overflow (content-visibility).
        <div className="page-anchor" aria-hidden>
          <span className="page-marker" title={`Page ${pageLabel} in the printed book`}>
            {pageLabel}
          </span>
        </div>
      )}
      <div data-block={b.id} data-page={b.page} className={`blk blk-${b.kind} relative${flow ? ` ${flow}` : ""}`}>
        <BlockInner b={b} />
      </div>
    </>
  );
});

/** A highlight's mark in the margin column; click it to see or remove the highlight. */
function HighlightMark({ marks }: { marks: Highlight[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hl-anchor">
      <button type="button" className="hl-mark" aria-label="Highlights here" title="Highlighted" onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="hl-pop font-ui" onMouseLeave={() => setOpen(false)}>
          {marks.map((h) => (
            <div key={h.id} className="flex items-start gap-2">
              <p className="line-clamp-3 min-w-0 flex-1">“{h.text}”</p>
              <button type="button" className="shrink-0 text-ink-3 hover:text-[var(--accent)]" onClick={() => useHighlights.getState().remove(h.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Figure zoom state lives here so figures can open it without prop drilling.
export type ZoomTarget = { page: number; rect: Block["rect"]; title: string; image?: string; caption?: Span[]; chapter?: number; table?: TableBlock };
export const useZoom = create<{
  target: ZoomTarget | null;
  set(t: ZoomTarget | null): void;
}>((set) => ({ target: null, set: (target) => set({ target }) }));
