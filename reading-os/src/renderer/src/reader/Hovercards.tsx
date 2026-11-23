// Context without leaving the line: hovering a citation shows the reference,
// hovering "Fig 1-1" / "Table 2-3" / "Box 4-2" previews it. Clicks jump.

import { useEffect, useRef, useState } from "react";
import type { Block } from "../../../shared/model";
import { blockAt, useReader } from "../state/reader";
import { PageCrop, Spans } from "./BlockView";

type Target =
  | { kind: "cite"; rect: DOMRect; chapter: number; nums: number[] }
  | { kind: "xref"; rect: DOMRect; key: string };

export function Hovercards({ root }: { root: React.RefObject<HTMLElement | null> }) {
  const [target, setTarget] = useState<Target | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targetFor = (node: Element): Target | null => {
      const cite = node.closest<HTMLElement>("sup.cite");
      if (cite)
        return {
          kind: "cite",
          rect: cite.getBoundingClientRect(),
          chapter: Number(cite.dataset.chapter),
          nums: (cite.dataset.cite ?? "").split(",").map(Number),
        };
      const xref = node.closest<HTMLElement>(".xref");
      if (xref) return { kind: "xref", rect: xref.getBoundingClientRect(), key: xref.dataset.xref ?? "" };
      return null;
    };
    const over = (e: MouseEvent) => {
      const t = targetFor(e.target as Element);
      if (!t) return;
      clearTimeout(hideTimer.current);
      clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => setTarget(t), 160);
    };
    const out = (e: MouseEvent) => {
      if (!targetFor(e.target as Element)) return;
      clearTimeout(showTimer.current);
      hideTimer.current = setTimeout(() => setTarget(null), 220);
    };
    const click = (e: MouseEvent) => {
      const node = e.target as Element;
      const { jumpTo, ix, setView } = useReader.getState();
      const xref = node.closest<HTMLElement>(".xref");
      if (xref && ix) {
        const id = ix.byKey.get(xref.dataset.xref ?? "");
        if (id) jumpTo({ blockId: id });
        setTarget(null);
        return;
      }
      const pageRef = node.closest<HTMLElement>("[data-page].pageref");
      if (pageRef) {
        jumpTo({ page: Number(pageRef.dataset.page) });
        return;
      }
      const marker = node.closest<HTMLElement>("[data-goto-page]");
      if (marker) {
        setView("page");
        jumpTo({ page: Number(marker.dataset.gotoPage) });
        return;
      }
      const cite = node.closest<HTMLElement>("sup.cite");
      if (cite) {
        const t = targetFor(cite);
        if (t) setTarget(t);
      }
    };
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseout", out);
    el.addEventListener("click", click);
    const close = () => setTarget(null);
    el.addEventListener("scroll", close, { passive: true });
    return () => {
      el.removeEventListener("mouseover", over);
      el.removeEventListener("mouseout", out);
      el.removeEventListener("click", click);
      el.removeEventListener("scroll", close);
    };
  }, [root]);

  if (!target) return null;
  const width = target.kind === "xref" ? 440 : 400;
  const left = Math.min(window.innerWidth - width - 16, Math.max(16, target.rect.left + target.rect.width / 2 - width / 2));
  const below = target.rect.bottom + 320 < window.innerHeight || target.rect.top < 340;
  const style: React.CSSProperties = below
    ? { left, top: target.rect.bottom + 8, width }
    : { left, bottom: window.innerHeight - target.rect.top + 8, width };

  return (
    <div
      ref={cardRef}
      style={style}
      role="dialog"
      onMouseEnter={() => clearTimeout(hideTimer.current)}
      onMouseLeave={() => (hideTimer.current = setTimeout(() => setTarget(null), 200))}
      className="fixed z-40 max-h-[60vh] overflow-y-auto rounded-xl bg-card p-4 font-ui text-[13px] leading-snug text-[var(--card-ink)] shadow-[var(--shadow)] ring-1 ring-rule"
    >
      {target.kind === "cite" ? <CiteCard chapter={target.chapter} nums={target.nums} onDone={() => setTarget(null)} /> : <XrefCard refKey={target.key} />}
    </div>
  );
}

function CiteCard({ chapter, nums, onDone }: { chapter: number; nums: number[]; onDone(): void }) {
  const book = useReader((s) => s.book);
  const refs = book?.chapters[chapter]?.refs ?? {};
  const showInList = (n: number) => {
    const li = document.getElementById(`ref-${chapter}-${n}`);
    const details = li?.closest("details");
    if (details) details.open = true;
    li?.scrollIntoView({ block: "center", behavior: "smooth" });
    li?.classList.add("landed");
    onDone();
  };
  return (
    <ol className="m-0 list-none space-y-2.5 p-0">
      {nums.map((n) => (
        <li key={n} className="flex gap-2.5">
          <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-accent">{n}</span>
          <span className="text-ink-2">
            {refs[n] ?? "Reference not found in this chapter."}
            {refs[n] && (
              <button type="button" onClick={() => showInList(n)} className="ml-2 text-[12px] text-link hover:underline">
                In list →
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function XrefCard({ refKey }: { refKey: string }) {
  const book = useReader((s) => s.book);
  const ix = useReader((s) => s.ix);
  if (!book || !ix) return null;
  const b: Block | undefined = blockAt(book, ix, ix.byKey.get(refKey) ?? null);
  if (!b) return <span className="text-ink-3">{refKey} isn't in this book.</span>;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-semibold text-accent">{refKey}</span>
        <span className="text-[11px] text-ink-3">page {book.pages[b.page]?.label} · click the link to go there</span>
      </div>
      {b.kind === "figure" && (
        <>
          <div className="rounded-md bg-[var(--figure-bg)] p-1.5">
            <PageCrop page={b.page} rect={b.rect} alt={refKey} maxWidth={400} className="mx-auto" />
          </div>
          <p className="mb-0 mt-2 text-ink-2">
            <Spans spans={b.caption} chapter={b.chapter} />
          </p>
        </>
      )}
      {b.kind === "table" && (
        <>
          <p className="mb-2 mt-0 font-medium">
            <Spans spans={b.caption} chapter={b.chapter} />
          </p>
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {b.rows.slice(0, 6).map((r, i) => (
                <tr key={i} className={i < b.headerRows ? "font-semibold" : "text-ink-2"}>
                  {r.map((c, k) => (
                    <td key={k} className="border-b border-rule px-1.5 py-1 align-top">
                      {c.length > 80 ? `${c.slice(0, 80)}…` : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {b.rows.length > 6 && <p className="mb-0 mt-1.5 text-[11px] text-ink-3">+ {b.rows.length - 6} more rows</p>}
        </>
      )}
      {b.kind === "box" && (
        <>
          <p className="mb-2 mt-0 font-medium">
            <Spans spans={b.title} chapter={b.chapter} />
          </p>
          <ul className="m-0 space-y-1 pl-4 text-ink-2">
            {b.body
              .flatMap((x) => (x.kind === "list" ? x.items : [x.spans]))
              .slice(0, 6)
              .map((it, i) => (
                <li key={i}>
                  <Spans spans={it} chapter={b.chapter} />
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}
