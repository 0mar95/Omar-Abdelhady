// Full-screen viewers and the figure dock.
// - Figures open full screen with zoom (wheel, pinch, double-click, + / −) and drag to pan.
// - Tables open full screen with a sticky header and room to breathe.
// - On wide windows, the figure you are reading about stays beside the text.

import { useEffect, useMemo, useRef, useState } from "react";
import type { FigureBlock } from "../../../shared/model";
import { useReader } from "../state/reader";
import { IconX } from "../ui/icons";
import { BookImage, FigureImage, PageCrop, Spans, stripKey, TableGrid, useZoom } from "./BlockView";

const MIN = 1;
const MAX = 6;

export function ZoomOverlay() {
  const target = useZoom((s) => s.target);
  const set = useZoom((s) => s.set);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useZoom.getState().target) return;
      if (e.key === "Escape") set(null);
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(MAX, s * 1.25));
      else if (e.key === "-") setScale((s) => Math.max(MIN, s / 1.25));
      else if (e.key === "0") (setScale(1), setPan({ x: 0, y: 0 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  useEffect(() => {
    if (scale === 1) setPan({ x: 0, y: 0 });
  }, [scale]);

  if (!target) return null;
  if (target.table) return <TableOverlay />;
  const w = target.rect.x1 - target.rect.x0;
  const h = target.rect.y1 - target.rect.y0;
  const fit = Math.min((window.innerWidth - 120) / w, (window.innerHeight - 170) / h);
  const boxW = target.image ? undefined : w * fit;
  const boxH = target.image ? undefined : h * fit;

  const zoomAt = (factor: number) => setScale((s) => Math.min(MAX, Math.max(MIN, s * factor)));
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#141311]/[0.96] font-ui text-white/85 backdrop-blur-sm"
      role="dialog"
      aria-label={target.title}
      onWheel={(e) => {
        // Trackpad pinch arrives as ctrl+wheel; a plain wheel zooms too.
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)));
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-4 text-[13px]">
        <span className="font-semibold text-white">{target.title}</span>
        <span className="ml-auto flex items-center gap-1">
          <ViewerButton label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
            −
          </ViewerButton>
          <button type="button" className="w-14 text-center tabular-nums text-white/70 hover:text-white" onClick={() => setScale(1)} title="Fit to screen (0)">
            {Math.round(scale * 100)}%
          </button>
          <ViewerButton label="Zoom in" onClick={() => zoomAt(1.25)}>
            +
          </ViewerButton>
          <ViewerButton label="Close (Esc)" onClick={() => set(null)}>
            <IconX size={16} />
          </ViewerButton>
        </span>
      </div>
      <div
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden ${scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || scale === 1) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
          setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved) return;
          // A click outside the picture closes; on the picture, it zooms.
          if (!(e.target as Element).closest(".zoom-picture")) set(null);
        }}
        onDoubleClick={() => setScale((s) => (s > 1 ? 1 : 2.5))}
      >
        <div
          className="zoom-picture rounded-md bg-white p-2 shadow-2xl transition-transform duration-75 will-change-transform"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, width: boxW, height: boxH ? boxH + 16 : undefined }}
        >
          {target.image ? (
            <BookImage image={target.image} alt={target.title} className="max-h-[calc(100vh-180px)] max-w-[calc(100vw-140px)] w-auto object-contain" />
          ) : (
            // Rendered sharper than it shows, so zooming in stays crisp.
            <PageCrop page={target.page} rect={target.rect} alt={target.title} maxWidth={w * fit * 2.5} scale={fit * 2.5} />
          )}
        </div>
      </div>
      {target.caption && target.caption.length > 0 && (
        <div className="mx-auto max-w-[760px] shrink-0 px-6 pb-5 pt-3 text-center text-[13px] leading-snug text-white/75">
          <Spans spans={target.caption} chapter={target.chapter ?? 0} />
        </div>
      )}
    </div>
  );
}

function ViewerButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-md text-[18px] text-white/75 hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

function TableOverlay() {
  const target = useZoom((s) => s.target)!;
  const set = useZoom((s) => s.set);
  const t = target.table!;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper font-ui" role="dialog" aria-label={target.title}>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-rule px-5 text-[13px]">
        <span className="font-semibold text-accent">{t.key}</span>
        <span className="min-w-0 truncate text-ink-2">
          <Spans spans={t.caption} chapter={t.chapter} />
        </span>
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={() => set(null)} className="ml-auto grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink">
          <IconX size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <TableGrid b={t} full />
        {t.notes.length > 0 && (
          <div className="mx-auto mt-3 max-w-[1100px] space-y-1 text-[12px] leading-snug text-ink-3">
            {t.notes.map((n, i) => (
              <p key={i} className="m-0">
                <Spans spans={n} chapter={t.chapter} />
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * On wide windows the figure being discussed stays in the left margin after
 * it scrolls away, until the text moves on (a new section, or a while later).
 */
export function FigureDock({ scrollRef, articleRef }: { scrollRef: React.RefObject<HTMLDivElement | null>; articleRef: React.RefObject<HTMLElement | null> }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const current = useReader((s) => s.currentBlock);
  const [room, setRoom] = useState<{ left: number; width: number } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    const art = articleRef.current;
    if (!el || !art) return;
    const measure = () => {
      const r = art.getBoundingClientRect();
      const space = r.left - el.getBoundingClientRect().left;
      const width = Math.min(340, space - 120);
      setRoom(width >= 220 ? { left: r.left - width - 84, width } : null);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(art);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => tick((n) => n + 1));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [scrollRef, articleRef]);

  // The figure most recently mentioned (or passed) above the reading line, in this section.
  const fig = useMemo<FigureBlock | null>(() => {
    const c = current ? ix.byId.get(current) : undefined;
    if (c === undefined) return null;
    for (let i = c; i >= 0 && i > c - 30; i--) {
      const b = book.blocks[i];
      if (b.kind === "heading" && b.level <= 2 && i < c) return null;
      if (b.kind === "figure") return b;
      const spans = b.kind === "paragraph" ? b.spans : b.kind === "list" ? b.items.flat() : [];
      const key = spans.find((s) => s.xref && /^fig/i.test(s.xref))?.xref;
      if (key) {
        const id = ix.byKey.get(key);
        const f = id ? book.blocks[ix.byId.get(id) ?? -1] : undefined;
        if (f?.kind === "figure") return f;
      }
    }
    return null;
  }, [current, book, ix]);

  if (!room || !fig || dismissed === fig.id) return null;
  // Only while the figure itself is out of sight.
  const el = scrollRef.current?.querySelector(`[data-block="${fig.id}"]`);
  const r = el?.getBoundingClientRect();
  if (!r || (r.bottom > 60 && r.top < window.innerHeight - 40)) return null;
  const open = () => useZoom.getState().set({ page: fig.page, rect: fig.rect, title: fig.key ?? "Figure", image: fig.image, caption: stripKey(fig.caption, fig.key), chapter: fig.chapter });
  return (
    <aside className="figure-dock font-ui" style={{ left: room.left, width: room.width }} aria-label="Figure being discussed">
      <button type="button" className="block w-full cursor-zoom-in rounded-md bg-[var(--figure-bg)] p-1.5 shadow-[0_0_0_1px_var(--rule)]" onClick={open} aria-label={`Enlarge ${fig.key ?? "figure"}`}>
        <FigureImage b={fig} maxWidth={room.width} />
      </button>
      <div className="mt-2 flex items-start gap-2 text-[11.5px] leading-snug text-ink-2">
        <div className="line-clamp-4 min-w-0 flex-1">
          {fig.key && <span className="mr-1 font-semibold text-accent">{fig.key}</span>}
          <Spans spans={stripKey(fig.caption, fig.key)} chapter={fig.chapter} />
        </div>
        <button type="button" aria-label="Hide" title="Hide" onClick={() => setDismissed(fig.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink">
          <IconX size={12} />
        </button>
      </div>
    </aside>
  );
}
