// The original pages, for when layout matters. Pages render only near the
// viewport (and are released when far away) so 400-page books stay light.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { contextFor, useCards, type Card } from "../ai";
import { pdfjs } from "../pdf";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { InlineCard } from "./InlineCard";

export function PageView({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const jump = useReader((s) => s.jump);
  const cards = useCards((s) => s.cards);
  const theme = useSettings((s) => s.theme);
  const [width, setWidth] = useState(820);
  const lastPage = useRef(-1);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(980, el.clientWidth - 48)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const cardsByPage = useMemo(() => {
    const m = new Map<number, Card[]>();
    for (const c of cards) {
      const i = ix.byId.get(c.blockId);
      if (i === undefined) continue;
      const p = book.blocks[i].page;
      m.set(p, [...(m.get(p) ?? []), c]);
    }
    return m;
  }, [cards, book, ix]);

  // Current page = the page under the reading line.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.3);
        const p = probe?.closest("[data-pdf-page]")?.getAttribute("data-pdf-page");
        if (p == null || Number(p) === lastPage.current) return;
        lastPage.current = Number(p);
        const block = book.blocks[ix.pageFirstBlock[Number(p)]];
        if (block) useReader.getState().setPosition(block.id);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, book, ix]);

  useEffect(() => {
    if (!jump) return;
    const page = jump.page ?? (jump.blockId ? book.blocks[ix.byId.get(jump.blockId) ?? 0]?.page : undefined);
    if (page === undefined) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    el?.scrollIntoView({ block: "start" });
    lastPage.current = page;
  }, [jump, book, ix, scrollRef]);

  const regenerate = (card: Card) =>
    useCards.getState().run(card.kind, card.blockId, card.quote, contextFor(book, ix, card.blockId, card.quote), card.question, card.id);

  const filter = theme === "dark" || theme === "black" ? "page-canvas-dark" : theme === "sepia" ? "page-canvas-sepia" : "";
  return (
    <div className="flex flex-col items-center gap-6 px-6 pb-[30vh] pt-20">
      {book.pages.map((p, i) => (
        <div key={i} className="flex w-full flex-col items-center">
          <PageSlot index={i} width={width} aspect={p.w / p.h} label={p.label} filter={filter} />
          {cardsByPage.get(i)?.map((c) => (
            <div key={c.id} style={{ width }}>
              <InlineCard card={c} onRegenerate={regenerate} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const PageSlot = memo(function PageSlot({ index, width, aspect, label, filter }: { index: number; width: number; aspect: number; label: string; filter: string }) {
  const doc = useReader((s) => s.doc);
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const height = width / aspect;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setNear(es.some((e) => e.isIntersecting)), { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    if (!near || !doc || !canvas || !textDiv) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined, background: "#ffffff" });
      await task.promise.catch(() => {});
      if (cancelled) return;
      textDiv.replaceChildren();
      textDiv.style.setProperty("--scale-factor", String(scale));
      textDiv.style.setProperty("--total-scale-factor", String(scale));
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await layer.render().catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      // Release the bitmap of pages far from view.
      canvas.width = 0;
      canvas.height = 0;
      textDiv.replaceChildren();
    };
  }, [near, doc, index, width]);

  return (
    <div
      ref={ref}
      data-pdf-page={index}
      className="relative rounded-[3px] bg-white shadow-[var(--shadow)]"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${filter}`} />
      <div ref={textRef} className="textLayer" />
      <span className="pointer-events-none absolute -left-12 top-1 w-10 text-right font-ui text-[11px] text-ink-3">{label}</span>
    </div>
  );
});
