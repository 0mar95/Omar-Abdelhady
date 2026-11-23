// ⌘K: one place to search the book, jump anywhere, run commands, or ask a
// question about what you're reading (answered inline, under your position).

import { useEffect, useMemo, useRef, useState } from "react";
import { spansText } from "../../../shared/model";
import { contextFor, useCards } from "../ai";
import { useReader } from "../state/reader";
import { useSettings, type Theme } from "../state/settings";
import { IconBook, IconImage, IconList, IconPage, IconSearch, IconSparkle, IconToc, IconType } from "../ui/icons";

interface Item {
  id: string;
  group: string;
  title: string;
  detail?: string;
  icon: React.ReactNode;
  run(): void;
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.max(0, lower.indexOf(terms[0]));
  const start = Math.max(0, at - 60);
  const s = text.slice(start, at + 140).replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${s}${at + 140 < text.length ? "…" : ""}`;
}

export function CommandPalette({ onOpenFile, onLibrary }: { onOpenFile(): void; onLibrary(): void }) {
  const book = useReader((s) => s.book);
  const ix = useReader((s) => s.ix);
  const { setOverlay, jumpTo, setView } = useReader.getState();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => setOverlay(null);

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const out: Item[] = [];
    const commands: Item[] = [
      { id: "c-open", group: "Commands", title: "Open a PDF…", icon: <IconPage />, run: onOpenFile },
      { id: "c-lib", group: "Commands", title: "Go to library", icon: <IconBook />, run: onLibrary },
    ];
    if (book) {
      commands.push(
        { id: "c-toc", group: "Commands", title: "Table of contents", icon: <IconToc />, run: () => setOverlay("toc") },
        { id: "c-type", group: "Commands", title: "Reading settings (font, size, theme)", icon: <IconType />, run: () => setOverlay("type") },
        {
          id: "c-view",
          group: "Commands",
          title: useReader.getState().view === "clean" ? "Switch to original pages" : "Switch to clean reading view",
          icon: <IconPage />,
          run: () => setView(useReader.getState().view === "clean" ? "page" : "clean"),
        },
      );
    }
    for (const t of ["light", "sepia", "dark", "black"] as Theme[])
      commands.push({ id: `c-theme-${t}`, group: "Commands", title: `Theme: ${t[0].toUpperCase()}${t.slice(1)}`, icon: <IconType />, run: () => useSettings.getState().set({ theme: t }) });

    if (book && ix && query) {
      const current = useReader.getState().currentBlock;
      out.push({
        id: "ask",
        group: "Ask",
        title: `Ask about what I'm reading: “${q.trim()}”`,
        detail: "Answered inline at your position, using only the text up to here (no spoilers)",
        icon: <IconSparkle />,
        run: () => {
          if (!current) return;
          const ctx = contextFor(book, ix, current, ix.texts[ix.byId.get(current) ?? 0]);
          ctx.selection = "(no selection — the question is about the current section)";
          useCards.getState().run("ask", current, q.trim(), ctx, q.trim());
          jumpTo({ blockId: current });
        },
      });
    }
    if (!query) return [...out, ...commands];

    out.push(...commands.filter((c) => terms.every((t) => c.title.toLowerCase().includes(t))));
    if (book && ix) {
      for (const t of book.toc) {
        if (terms.every((w) => t.title.toLowerCase().includes(w)))
          out.push({
            id: `t-${t.id}`,
            group: "Sections",
            title: t.title,
            detail: `page ${book.pages[t.page]?.label}`,
            icon: <IconList />,
            run: () => jumpTo({ blockId: t.blockId }),
          });
        if (out.filter((i) => i.group === "Sections").length >= 8) break;
      }
      let figs = 0;
      for (const b of book.blocks) {
        if ((b.kind !== "figure" && b.kind !== "table" && b.kind !== "box") || !b.key) continue;
        const text = ix.texts[ix.byId.get(b.id)!].toLowerCase();
        if (terms.every((w) => text.includes(w) || b.key!.toLowerCase().includes(w))) {
          out.push({
            id: `f-${b.id}`,
            group: "Figures, tables & boxes",
            title: `${b.key} · ${(b.kind === "box" ? spansText(b.title) : spansText(b.caption)).slice(0, 100)}`,
            detail: `page ${book.pages[b.page]?.label}`,
            icon: <IconImage />,
            run: () => jumpTo({ blockId: b.id }),
          });
          if (++figs >= 6) break;
        }
      }
      let hits = 0;
      for (let i = 0; i < book.blocks.length && hits < 40; i++) {
        const b = book.blocks[i];
        // Reference lists and the index match everything; they aren't reading text.
        if (b.kind === "index" || b.kind === "heading" || b.kind === "references") continue;
        const text = ix.texts[i];
        const lower = text.toLowerCase();
        if (!terms.every((w) => lower.includes(w))) continue;
        hits++;
        const ch = book.chapters[b.chapter];
        out.push({
          id: `s-${b.id}`,
          group: "In the book",
          title: snippet(text, terms),
          detail: `${ch?.number ? `Ch. ${ch.number} · ` : ""}page ${book.pages[b.page]?.label}`,
          icon: <IconSearch />,
          run: () => {
            setView("clean");
            jumpTo({ blockId: b.id, highlight: query });
          },
        });
      }
    }
    return out;
  }, [q, book, ix, onOpenFile, onLibrary, jumpTo, setOverlay, setView]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: Item | undefined) => {
    if (!i) return;
    close();
    i.run();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/25 pt-[12vh] backdrop-blur-[2px]" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-fit max-h-[70vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-2xl bg-card font-ui shadow-[0_24px_80px_rgb(0_0_0/0.3)] ring-1 ring-rule"
      >
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <IconSearch className="text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[sel]);
              } else if (e.key === "Escape") close();
            }}
            placeholder={book ? "Search the book, jump to a section, or ask a question…" : "Type a command…"}
            className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <kbd className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-3">esc</kbd>
        </div>
        <div ref={listRef} className="scroll-quiet overflow-y-auto py-2">
          {items.length === 0 && <div className="px-5 py-8 text-center text-[13px] text-ink-3">No matches in this book.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {header && <div className="px-5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{header}</div>}
                <button
                  type="button"
                  data-idx={i}
                  onMouseMove={() => setSel(i)}
                  onClick={() => choose(it)}
                  className={`mx-2 flex w-[calc(100%-1rem)] items-start gap-3 rounded-lg px-3 py-2 text-left ${i === sel ? "bg-accent-soft" : ""}`}
                >
                  <span className={`mt-0.5 shrink-0 ${it.group === "Ask" ? "text-accent" : "text-ink-3"}`}>{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] leading-snug text-ink">{it.title}</span>
                    {it.detail && <span className="mt-0.5 block text-[11.5px] text-ink-3">{it.detail}</span>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
