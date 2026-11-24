// The reflowed reading view: the whole book as clean, typographic text, with
// AI cards woven in under the paragraphs they explain.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarginNote } from "../../../shared/ipc";
import type { Block } from "../../../shared/model";
import { contextFor, useCards, type Card } from "../ai";
import { paintHighlights, useHighlights, type Highlight } from "../state/highlights";
import { useNotes } from "../state/notes";
import { quizSections, useStudy } from "../state/study";
import { SectionQuiz } from "./Study";
import { useReader } from "../state/reader";
import { FONTS, useSettings } from "../state/settings";
import { BlockView, ChapterList, TitlePage } from "./BlockView";
import { InlineCard } from "./InlineCard";
import { outlineOf } from "./outline";
import { FigureDock } from "./Viewers";
import { GutterNote, InlineNote } from "./MarginNote";

/** Memoized: the reader's bars and progress update while scrolling without re-rendering the book. */
export const CleanView = memo(function CleanView({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const jump = useReader((s) => s.jump);
  const cards = useCards((s) => s.cards);
  const settings = useSettings();
  const notes = useNotes((s) => s.notes);
  const working = useNotes((s) => s.working);
  const highlights = useHighlights((s) => s.list);
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

  useEffect(() => {
    void useHighlights.getState().load(book.id);
    void useStudy.getState().load(book.id);
  }, [book.id]);
  // "Check yourself" goes after the last block of each section with enough to ask about.
  const quizAfter = useMemo(() => quizSections(book, ix), [book, ix]);
  const marksByBlock = useMemo(() => {
    const m = new Map<string, Highlight[]>();
    for (const h of highlights) m.set(h.blockId, [...(m.get(h.blockId) ?? []), h]);
    return m;
  }, [highlights]);
  // Paint after the blocks render (and again when they change).
  useEffect(() => {
    const art = articleRef.current;
    if (!art) return;
    let t = setTimeout(() => paintHighlights(art, highlights), 50);
    // Blocks re-render (glossary marks, cards): paint again once they settle.
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => paintHighlights(art, highlights), 200);
    });
    if (highlights.length) mo.observe(art, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(t);
      mo.disconnect();
    };
  }, [highlights, book]);

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
  // A few times a second is plenty, and keeps hit-testing out of most frames.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer = 0;
    const probe = () => {
      timer = 0;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.3);
      const id = hit?.closest("[data-block]")?.getAttribute("data-block");
      if (id && id !== lastReported.current) {
        lastReported.current = id;
        useReader.getState().setPosition(id);
      }
    };
    const onScroll = () => {
      if (!timer) timer = window.setTimeout(probe, 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [scrollRef]);

  // Book-style indents need to know which paragraphs run on from one another.
  const flows = useMemo(() => {
    const para = (b?: Block) => b?.kind === "paragraph" && !b.small;
    return book.blocks.map((b, i) => {
      if (!para(b)) return undefined;
      const f = `${para(book.blocks[i - 1]) ? "jp" : ""} ${para(book.blocks[i + 1]) ? "jn" : ""}`.trim();
      return f || undefined;
    });
  }, [book]);

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

  const regenerate = useCallback(
    (card: Card) => {
      useCards.getState().run(card.kind, card.blockId, card.quote, contextFor(book, ix, card.blockId, card.quote), card.question, card.id);
    },
    [book, ix],
  );

  const style = {
    "--reader-font": FONTS[settings.font].css,
    "--reader-size": `${settings.size}px`,
    "--reader-leading": String(settings.leading),
    "--reader-measure": `${settings.measure}ch`,
    "--reader-align": settings.justify ? "justify" : "left",
  } as React.CSSProperties;

  // Every book opens with a composed title page, then its contents.
  const opening = useMemo(() => {
    const titlePage = book.blocks.find((b) => b.kind === "titlepage");
    const about = book.blocks.find((b) => b.kind === "about");
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    // Without title pages, a first heading that just repeats the title would show twice.
    const first = book.blocks[0];
    // The cover picture already sits on the title page: don't show it again at full size.
    const cover = book.blocks.slice(0, 4).find((b) => b.kind === "figure" && b.image && b.page <= 1);
    const skip = !titlePage && first?.kind === "heading" && norm(first.text) === norm(book.title) ? first.id : null;
    // Only compose a title page from the file's details when they name the book properly.
    const decent = !/^(?:abstract|preface|foreword|contents|introduction|untitled|chapter \d+)$/i.test(book.title.trim()) && /\p{L}{3,}/u.test(book.title) && !/\.\.|^\S+\.\d+/.test(book.title);
    const synth = !titlePage && decent;
    // Kenning's own contents (the printed one isn't shown): after the title page and About this book.
    const afterId = about?.id ?? titlePage?.id;
    return { synth, afterId, list: true, listAtTop: synth && !afterId, skip: synth ? skip : null, cover: synth ? cover?.id : undefined };
  }, [book]);

  // Key points shown in a chapter opener aren't repeated where they were printed.
  const pulled = useMemo(() => outlineOf(book, ix).pulled, [book, ix]);

  return (
    <div className="reader px-6 pb-[40vh] pt-20 sm:px-12" style={style}>
      <article ref={articleRef} className={`book ${settings.indent ? "indented" : ""} ${gutter ? "with-gutter" : ""} ${settings.focus ? "focus" : ""}`} lang="en">
        {opening.synth && <TitlePage b={{ title: "", details: [] }} />}
        {opening.listAtTop && <ChapterList />}
        {book.blocks.map((b, i) => {
          if (b.id === opening.skip || b.id === opening.cover || pulled.has(b.id)) return null;
          // Printed page numbers belong to the PDF, not to this book: not shown.
          const label = undefined;
          const attached = cardsByBlock.get(b.id);
          const note = settings.marginNotes && b.kind === "heading" ? notes.get(b.id) : undefined;
          const isWorking = settings.marginNotes && working === b.id;
          const block = (
            <BlockWithCards
              key={b.id}
              block={b}
              label={label}
              flow={flows[i]}
              cards={attached}
              onRegenerate={regenerate}
              note={note}
              working={isWorking}
              gutter={gutter}
              marks={marksByBlock.get(b.id)}
              quiz={quizAfter.get(b.id)}
            />
          );
          return b.id === opening.afterId && opening.list ? (
            <Fragment key={b.id}>
              {block}
              <ChapterList />
            </Fragment>
          ) : (
            block
          );
        })}
        <div className="blk mt-24 text-center font-ui text-sm text-ink-3">End of book</div>
      </article>
      <FigureDock scrollRef={scrollRef} articleRef={articleRef} />
      {settings.focus && <FocusStyle />}
    </div>
  );
});

const BlockWithCards = memo(function BlockWithCards({
  block,
  label,
  flow,
  cards,
  onRegenerate,
  note,
  working,
  gutter,
  marks,
  quiz,
}: {
  block: Block;
  label?: string;
  flow?: string;
  cards?: Card[];
  onRegenerate(c: Card): void;
  note?: MarginNote;
  working?: boolean;
  gutter: boolean;
  marks?: Highlight[];
  quiz?: string;
}) {
  return (
    <>
      {gutter && <GutterNote note={note} working={!!working} level={block.kind === "heading" ? block.level : 2} />}
      <BlockView b={block} pageLabel={label} flow={flow} marks={marks} />
      {!gutter && <InlineNote note={note} />}
      {cards?.map((c) => <InlineCard key={c.id} card={c} onRegenerate={onRegenerate} />)}
      {quiz && <SectionQuiz headingId={quiz} />}
    </>
  );
});

/** Focus mode: everything but the block being read is dimmed (a style rule, so the book never re-renders). */
function FocusStyle() {
  const current = useReader((s) => s.currentBlock);
  if (!current) return null;
  return <style>{`.book.focus [data-block="${CSS.escape(current)}"]{opacity:1}`}</style>;
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
