// The reflowed reading view: the whole book as clean, typographic text, with
// AI cards woven in under the paragraphs they explain.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MarginNote } from "../../../shared/ipc";
import { contextFor, useCards, type Card } from "../ai";
import { useNotes } from "../state/notes";
import { useReader } from "../state/reader";
import { FONTS, useSettings } from "../state/settings";
import { BlockView } from "./BlockView";
import { InlineCard } from "./InlineCard";
import { GutterNote, InlineNote } from "./MarginNote";

export function CleanView({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const jump = useReader((s) => s.jump);
  const cards = useCards((s) => s.cards);
  const settings = useSettings();
  const notes = useNotes((s) => s.notes);
  const working = useNotes((s) => s.working);
  const lastReported = useRef<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [gutter, setGutter] = useState(false);

  // Notes go in the right margin when there is room for them.
  useEffect(() => {
    const el = scrollRef.current;
    const art = articleRef.current;
    if (!el || !art) return;
    const ro = new ResizeObserver(() => setGutter((el.clientWidth - art.getBoundingClientRect().width) / 2 >= 300));
    ro.observe(el);
    ro.observe(art);
    return () => ro.disconnect();
  }, [scrollRef]);

  const cardsByBlock = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards) {
      const list = m.get(c.blockId) ?? [];
      list.push(c);
      m.set(c.blockId, list);
    }
    return m;
  }, [cards]);

  // Track the block at the reading line (a third of the way down the screen).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const probe = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.3);
        const id = probe?.closest("[data-block]")?.getAttribute("data-block");
        if (id && id !== lastReported.current) {
          lastReported.current = id;
          useReader.getState().setPosition(id);
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  // Jumps from the table of contents, search, links and restored positions.
  useEffect(() => {
    if (!jump?.blockId) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-block="${jump.blockId}"]`);
    if (!el) return;
    const go = () => el.scrollIntoView({ block: "start" });
    go();
    // Blocks above may grow as they render (content-visibility); settle again.
    const t1 = setTimeout(go, 60);
    const t2 = setTimeout(go, 220);
    // The jump target is the new reading position (progress, notes, spoiler limit).
    lastReported.current = jump.blockId;
    useReader.getState().setPosition(jump.blockId);
    if (jump.highlight) highlightIn(el, jump.highlight);
    else if (jump.nonce && Date.now() - jump.nonce < 2000 && useReader.getState().status === "ready") {
      el.classList.remove("landed");
      void el.offsetWidth;
      el.classList.add("landed");
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [jump, scrollRef]);

  const regenerate = (card: Card) => {
    useCards.getState().run(card.kind, card.blockId, card.quote, contextFor(book, ix, card.blockId, card.quote), card.question, card.id);
  };

  const style = {
    "--reader-font": FONTS[settings.font].css,
    "--reader-size": `${settings.size}px`,
    "--reader-leading": String(settings.leading),
    "--reader-measure": `${settings.measure}ch`,
    "--reader-align": settings.justify ? "justify" : "left",
  } as React.CSSProperties;

  let prevPage = -1;
  return (
    <div className="reader px-6 pb-[40vh] pt-20 sm:px-12" style={style}>
      <article ref={articleRef} className={`book ${settings.indent ? "indented" : ""} ${gutter ? "with-gutter" : ""}`} lang="en">
        {book.blocks.map((b) => {
          const label = settings.pageNumbers && b.page !== prevPage ? book.pages[b.page]?.label : undefined;
          prevPage = b.page;
          const attached = cardsByBlock.get(b.id);
          const note = settings.marginNotes && b.kind === "heading" ? notes.get(b.id) : undefined;
          const isWorking = settings.marginNotes && working === b.id;
          return (
            <BlockWithCards
              key={b.id}
              block={b}
              label={label}
              cards={attached}
              onRegenerate={regenerate}
              note={note}
              working={isWorking}
              gutter={gutter}
            />
          );
        })}
        <div className="blk mt-24 text-center font-ui text-sm text-ink-3">End of book</div>
      </article>
    </div>
  );
}

function BlockWithCards({
  block,
  label,
  cards,
  onRegenerate,
  note,
  working,
  gutter,
}: {
  block: Parameters<typeof BlockView>[0]["b"];
  label?: string;
  cards?: Card[];
  onRegenerate(c: Card): void;
  note?: MarginNote;
  working?: boolean;
  gutter: boolean;
}) {
  return (
    <>
      {gutter && <GutterNote note={note} working={!!working} level={block.kind === "heading" ? block.level : 2} />}
      <BlockView b={block} pageLabel={label} />
      {!gutter && <InlineNote note={note} />}
      {cards?.map((c) => <InlineCard key={c.id} card={c} onRegenerate={onRegenerate} />)}
    </>
  );
}

/** Highlights search hits inside a block using the CSS Custom Highlight API. */
function highlightIn(el: HTMLElement, query: string) {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.toLowerCase() ?? "";
    for (const t of terms) {
      let at = text.indexOf(t);
      while (at >= 0) {
        const r = document.createRange();
        r.setStart(n, at);
        r.setEnd(n, at + t.length);
        ranges.push(r);
        at = text.indexOf(t, at + t.length);
      }
    }
  }
  registry.set("search-hit", new HighlightCtor(...ranges));
  setTimeout(() => registry.delete("search-hit"), 4000);
}
