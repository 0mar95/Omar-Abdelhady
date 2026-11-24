// Renders one book block. Interactive bits (citations, figure links, page
// links) are plain elements with data attributes; Reader handles hover and
// clicks for all of them with a few delegated listeners.

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import type { Block, BookDoc, BoxBlock, ContentsBlock, ContentsEntry, FigureBlock, Span, TableBlock } from "../../../shared/model";
import type { TermMatch } from "../../../shared/glossary/extract";
import { imageUrl } from "../formats";
import { renderRegion } from "../pdf";
import { useGlossary } from "../state/glossary";
import { useReader, type BookIndex } from "../state/reader";
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
        onClick={() => setZoom({ page: b.page, rect: b.rect, title: b.key ?? "Figure", image: b.image })}
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

function stripKey(spans: Span[], key?: string): Span[] {
  if (!key || !spans.length) return spans;
  const first = spans[0];
  const re = new RegExp(`^\\s*${key.replace(/\s+/, "\\s*").replace("-", "\\s*-\\s*")}\\s*`);
  if (re.test(first.text)) return [{ ...first, text: first.text.replace(re, "") }, ...spans.slice(1)].filter((s) => s.text);
  return spans;
}

function Table({ b }: { b: TableBlock }) {
  const [original, setOriginal] = useState(b.rows.length === 0);
  const head = b.rows.slice(0, b.headerRows);
  const body = b.rows.slice(b.headerRows);
  return (
    <div className="my-8 font-ui" data-key={b.key}>
      <div className="mb-2 flex items-baseline gap-2 text-[0.82em] leading-snug">
        <span className="shrink-0 font-semibold text-accent">{b.key}</span>
        <span className="text-ink-2">
          <Spans spans={b.caption} chapter={b.chapter} />
        </span>
        {b.rows.length > 0 && b.parts.length > 0 && (
          <button
            type="button"
            onClick={() => setOriginal((v) => !v)}
            className="ml-auto shrink-0 rounded-full border border-rule px-2.5 py-0.5 text-[0.85em] text-ink-3 hover:border-accent hover:text-accent"
          >
            {original ? "Reflowed" : "Original"}
          </button>
        )}
      </div>
      {original ? (
        <div className="flex flex-col items-center gap-2 rounded-md bg-[var(--figure-bg)] p-2 shadow-[0_0_0_1px_var(--rule)]">
          {b.parts.map((p, i) => (
            <PageCrop key={i} page={p.page} rect={p.rect} alt={`${b.key} (original)`} maxWidth={900} />
          ))}
        </div>
      ) : (
        <div className="scroll-quiet overflow-x-auto rounded-md shadow-[0_0_0_1px_var(--rule)]">
          <table className="w-full border-collapse text-[0.78em] leading-snug">
            {head.length > 0 && (
              <thead>
                {head.map((r, i) => (
                  <tr key={i} className="bg-paper-2">
                    {r.map((c, k) => (
                      <th key={k} className="whitespace-pre-line border-b border-rule px-3 py-2 text-left align-bottom font-semibold text-ink">
                        {c}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
            )}
            <tbody>
              {body.map((r, i) => (
                <tr key={i} className="border-b border-rule/70 last:border-0 even:bg-paper-2/40">
                  {r.map((c, k) => (
                    <td key={k} className={`whitespace-pre-line px-3 py-2 align-top ${k === 0 ? "font-medium text-ink" : "text-ink-2"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Where a contents entry points: its printed page (and the heading there), else a heading of that title. */
function contentsTarget(book: BookDoc, ix: BookIndex, from: number, e: ContentsEntry): string | null {
  const title = norm(e.title);
  const page = book.pages.findIndex((p, i) => i > book.blocks[from].page && p.label === e.page);
  if (page >= 0) {
    const start = ix.pageFirstBlock[page];
    for (let i = start; i < book.blocks.length && book.blocks[i].page <= page + 1; i++) {
      const b = book.blocks[i];
      if (b.kind === "heading" && norm(b.text) === title) return b.id;
    }
    return book.blocks[start]?.id ?? null;
  }
  const t = book.toc.find((x) => norm(x.title) === title && (ix.byId.get(x.blockId) ?? 0) > from);
  return t?.blockId ?? null;
}

function Contents({ b }: { b: ContentsBlock }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const targets = useMemo(() => {
    const from = ix.byId.get(b.id) ?? 0;
    return b.entries.map((e) => contentsTarget(book, ix, from, e));
  }, [b, book, ix]);
  return (
    <ol className="contents font-ui text-[0.88em]">
      {b.entries.map((e, i) => (
        <li key={i} className={e.num?.includes(".") ? "sub" : e.num ? "chapter" : undefined}>
          <button type="button" disabled={!targets[i]} onClick={() => targets[i] && useReader.getState().jumpTo({ blockId: targets[i]! })}>
            <span className="num">{e.num}</span>
            <span className="min-w-0">
              <span className={e.num && !e.num.includes(".") ? "font-medium" : "text-ink-2"}>{e.title}</span>
              {e.authors && <span className="mt-0.5 block text-[0.82em] font-normal italic text-ink-3">{e.authors}</span>}
            </span>
            <span className="leader" aria-hidden />
            <span className="pg">{e.page}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function BlockInner({ b }: { b: Block }) {
  // Glossary terms are marked at their first mention in each section.
  const allow = useGlossary((g) => g.allowed.get(b.id));
  const seen: TermMarks = { allow: allow ?? EMPTY, done: new Set() };
  switch (b.kind) {
    case "heading":
      if (b.level === 1)
        return (
          <header className="mb-10 mt-16 first:mt-4">
            {b.number && <div className="font-ui text-[3.2em] font-light leading-none tracking-tight text-accent">{b.number}</div>}
            <h1 id={b.id} className="mt-3 font-ui text-[2em] font-semibold leading-[1.15] tracking-tight">
              {b.text}
            </h1>
          </header>
        );
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
      return <Contents b={b} />;
    case "code":
      return (
        <pre className="scroll-quiet my-5 overflow-x-auto rounded-lg bg-paper-2 px-4 py-3 font-mono text-[0.78em] leading-relaxed text-ink ring-1 ring-rule/60">
          <code>{b.lines.join("\n")}</code>
        </pre>
      );
  }
}

/** flow: "jp" when a paragraph follows a paragraph, "jn" when one comes next (book-style indents). */
export const BlockView = memo(function BlockView({ b, pageLabel, flow }: { b: Block; pageLabel?: string; flow?: string }) {
  return (
    <>
      {pageLabel && (
        // A zero-height sibling: blocks clip their own overflow (content-visibility).
        <div className="page-anchor" aria-hidden>
          <span className="page-marker" data-goto-page={b.page} title={`Page ${pageLabel} in the original — click to view it`}>
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

// Figure zoom state lives here so figures can open it without prop drilling.
type ZoomTarget = { page: number; rect: Block["rect"]; title: string; image?: string };
export const useZoom = create<{
  target: ZoomTarget | null;
  set(t: ZoomTarget | null): void;
}>((set) => ({ target: null, set: (target) => set({ target }) }));
