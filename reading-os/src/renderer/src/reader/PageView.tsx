// The original pages, for when layout matters. Pages render only near the
// viewport (and are released when far away) so 400-page books stay light.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { contextFor, useCards, type Card } from "../ai";
import { pdfjs } from "../pdf";
import { useReader } from "../state/reader";
import { useSettings, type Theme } from "../state/settings";
import { InlineCard } from "./InlineCard";

export const PageView = memo(function PageView({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
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
    const target = jump.blockId ?? book.blocks[ix.pageFirstBlock[page]]?.id;
    if (target) useReader.getState().setPosition(target);
  }, [jump, book, ix, scrollRef]);

  const regenerate = (card: Card) =>
    useCards.getState().run(card.kind, card.blockId, card.quote, contextFor(book, ix, card.blockId, card.quote), card.question, card.id);

  // Pages without extracted text are scans: their full-page image takes the theme too.
  const textPages = useMemo(() => new Set(book.blocks.map((b) => b.page)), [book]);
  return (
    <div className="flex flex-col items-center gap-6 px-6 pb-[30vh] pt-20">
      {book.pages.map((p, i) => (
        <div key={i} className="flex w-full flex-col items-center">
          <PageSlot index={i} width={width} aspect={p.w / p.h} label={p.label} theme={theme} hasText={textPages.has(i)} />
          {cardsByPage.get(i)?.map((c) => (
            <div key={c.id} style={{ width }}>
              <InlineCard card={c} onRegenerate={regenerate} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

const PageSlot = memo(function PageSlot({
  index,
  width,
  aspect,
  label,
  theme,
  hasText,
}: {
  index: number;
  width: number;
  aspect: number;
  label: string;
  theme: Theme;
  hasText: boolean;
}) {
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
      // A damaged page stays blank instead of breaking the view.
      const page = await doc.getPage(index + 1).catch(() => null);
      if (cancelled || !page) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const themed = theme !== "light";
      const render = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        background: "#ffffff",
        // Where each image landed, so photos can keep their colors under a theme.
        recordImages: themed,
      });
      task = render;
      await render.promise.catch(() => {});
      if (cancelled) return;
      if (themed) recolorPage(canvas, theme, render.imageCoordinates ?? page.imageCoordinates, hasText);
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
  }, [near, doc, index, width, theme, hasText]);

  return (
    <div
      ref={ref}
      data-pdf-page={index}
      // Dark themes get a dark placeholder, so pages still loading don't flash white.
      className={`relative rounded-[3px] shadow-[var(--shadow)] ${theme === "light" ? "bg-white" : "bg-paper"}`}
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textRef} className="textLayer" />
      <span className="pointer-events-none absolute -left-12 top-1 w-10 text-right font-ui text-[11px] text-ink-3">{label}</span>
    </div>
  );
});

const PAGE_COLORS: Record<Exclude<Theme, "light">, { paper: string; ink: string }> = {
  sepia: { paper: "#f6efe2", ink: "#3a2f23" },
  dark: { paper: "#1c1b19", ink: "#e6e1d8" },
  black: { paper: "#000000", ink: "#d9d6d0" },
};

/**
 * Gives a rendered page the reading theme: paper, text and drawn diagrams take
 * the theme's colors (dark themes invert lightness but keep hues), while
 * photos and other images are put back exactly as printed.
 */
function recolorPage(canvas: HTMLCanvasElement, theme: Exclude<Theme, "light">, coords: ArrayLike<number> | null, hasText: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width || !canvas.height) return;
  const W = canvas.width;
  const H = canvas.height;
  const orig = document.createElement("canvas");
  orig.width = W;
  orig.height = H;
  orig.getContext("2d")!.drawImage(canvas, 0, 0);
  const { paper, ink } = PAGE_COLORS[theme];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (theme === "sepia") {
    // Black lifts to sepia ink, white sinks to sepia paper.
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.clearRect(0, 0, W, H);
    ctx.filter = "invert(1) hue-rotate(180deg)";
    ctx.drawImage(orig, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = "source-over";
  // Images go back in their own colors (a little dimmer on dark pages). A
  // page-sized image on a page without text is a scan: it keeps the theme.
  if (theme !== "sepia") ctx.filter = "brightness(0.9)";
  for (let k = 0; coords && k + 5 < coords.length; k += 6) {
    const xs = [coords[k], coords[k + 2], coords[k + 4], coords[k + 2] + coords[k + 4] - coords[k]];
    const ys = [coords[k + 1], coords[k + 3], coords[k + 5], coords[k + 3] + coords[k + 5] - coords[k + 1]];
    const x0 = Math.max(0, Math.floor(Math.min(...xs) * W));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) * H));
    const x1 = Math.min(W, Math.ceil(Math.max(...xs) * W));
    const y1 = Math.min(H, Math.ceil(Math.max(...ys) * H));
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    if (!hasText && (x1 - x0) * (y1 - y0) > W * H * 0.85) continue;
    ctx.drawImage(orig, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
  orig.width = 0;
  orig.height = 0;
}
