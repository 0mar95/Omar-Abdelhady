// Floating actions over selected text. The answer appears as an inline card
// right under the paragraph, so the reader never leaves the page.

import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIONS, contextFor, useCards, type ActionKind } from "../ai";
import { useReader } from "../state/reader";
import { IconBulb, IconCopy, IconFeather, IconList, IconQuestion, IconSparkle } from "../ui/icons";

interface Sel {
  text: string;
  blockId: string;
  rect: DOMRect;
}

const ICONS: Record<ActionKind, React.ReactNode> = {
  explain: <IconSparkle size={15} />,
  simplify: <IconFeather size={15} />,
  summarize: <IconList size={15} />,
  terms: <IconBulb size={15} />,
  ask: <IconQuestion size={15} />,
};

/** Finds the block a selection belongs to (by its end, where the card goes). */
function blockForSelection(range: Range, text: string): string | null {
  const node = range.endContainer.nodeType === 1 ? (range.endContainer as Element) : range.endContainer.parentElement;
  const blockEl = node?.closest("[data-block]");
  if (blockEl) return blockEl.getAttribute("data-block");
  // Page view: match the selected text against the blocks of that page.
  const pageEl = node?.closest("[data-pdf-page]");
  const { book, ix } = useReader.getState();
  if (!pageEl || !book || !ix) return null;
  const page = Number(pageEl.getAttribute("data-pdf-page"));
  const probe = text.replace(/\s+/g, " ").slice(0, 40).toLowerCase();
  let first: string | null = null;
  for (let i = ix.pageFirstBlock[page]; i < book.blocks.length && book.blocks[i].page <= page; i++) {
    if (book.blocks[i].page !== page) continue;
    first ??= book.blocks[i].id;
    if (ix.texts[i].replace(/\s+/g, " ").toLowerCase().includes(probe)) return book.blocks[i].id;
  }
  return first;
}

export function SelectionMenu({ scrollRoot }: { scrollRoot: React.RefObject<HTMLElement | null> }) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const read = useCallback(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) {
      if (!asking) setSel(null);
      return;
    }
    const range = s.getRangeAt(0);
    const root = scrollRoot.current;
    if (!root || !root.contains(range.commonAncestorContainer)) return;
    const text = s.toString().trim();
    if (text.length < 2) return;
    const blockId = blockForSelection(range, text);
    if (!blockId) return;
    const rects = range.getClientRects();
    const rect = rects.length ? rects[0] : range.getBoundingClientRect();
    setSel({ text, blockId, rect });
  }, [asking, scrollRoot]);

  useEffect(() => {
    const onUp = () => setTimeout(read, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSel(null);
        setAsking(false);
      }
      if (e.shiftKey && e.key.startsWith("Arrow")) setTimeout(read, 0);
    };
    const onScroll = () => sel && setTimeout(read, 0);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onKey);
    const root = scrollRoot.current;
    root?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onKey);
      root?.removeEventListener("scroll", onScroll);
    };
  }, [read, scrollRoot, sel]);

  const run = (kind: ActionKind, q?: string) => {
    const { book, ix } = useReader.getState();
    if (!sel || !book || !ix) return;
    useCards.getState().run(kind, sel.blockId, sel.text, contextFor(book, ix, sel.blockId, sel.text), q);
    window.getSelection()?.removeAllRanges();
    setSel(null);
    setAsking(false);
    setQuestion("");
  };

  if (!sel) return null;
  const width = asking ? 380 : 470;
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, sel.rect.left + sel.rect.width / 2 - width / 2));
  const above = sel.rect.top > 70;
  const top = above ? sel.rect.top - 50 : sel.rect.bottom + 10;

  return (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Selection actions"
      onMouseDown={(e) => e.preventDefault() /* keep the selection */}
      style={{ left, top, width: asking ? width : undefined }}
      className="fixed z-40 flex items-center gap-0.5 rounded-xl bg-[#211f1c] p-1 font-ui text-[13px] text-[#f1ece3] shadow-[0_8px_30px_rgb(0_0_0/0.28)] ring-1 ring-black/20 dark:bg-[#34312c]"
    >
      {asking ? (
        <form
          className="flex w-full items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) run("ask", question.trim());
          }}
        >
          <IconQuestion size={15} className="ml-2 shrink-0 opacity-70" />
          <input
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="Ask about this passage…"
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-white/40"
          />
          <button type="submit" className="rounded-lg bg-[var(--accent)] px-3 py-1.5 font-medium text-white">
            Ask
          </button>
        </form>
      ) : (
        <>
          {(Object.keys(ACTIONS) as ActionKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => (k === "ask" ? setAsking(true) : run(k))}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-white/10"
            >
              <span className="opacity-80">{ICONS[k]}</span>
              {ACTIONS[k].label}
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-white/15" />
          <button
            type="button"
            title="Copy"
            aria-label="Copy"
            onClick={() => {
              void navigator.clipboard.writeText(sel.text);
              setSel(null);
            }}
            className="grid size-8 place-items-center rounded-lg hover:bg-white/10"
          >
            <IconCopy size={15} />
          </button>
        </>
      )}
    </div>
  );
}
