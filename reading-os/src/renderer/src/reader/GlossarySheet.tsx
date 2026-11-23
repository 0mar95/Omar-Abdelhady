// The book's glossary, A to Z: every term the book defines, with its
// definition and where it is defined. Built from the text (the printed
// glossary of many books is missing or online-only).

import { useMemo, useState } from "react";
import { useGlossary } from "../state/glossary";
import { pageText, useReader } from "../state/reader";
import { IconSparkle, IconX } from "../ui/icons";

export function GlossarySheet() {
  const terms = useGlossary((g) => g.terms);
  const ai = useGlossary((g) => g.ai);
  const book = useReader((r) => r.book)!;
  const { setOverlay, jumpTo, setView } = useReader.getState();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return terms;
    return terms.filter((t) => t.term.toLowerCase().includes(query) || t.expansion?.toLowerCase().includes(query) || t.definition.toLowerCase().includes(query));
  }, [terms, q]);
  let letter = "";
  return (
    <div className="fixed inset-0 z-50 flex" onMouseDown={() => setOverlay(null)}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
      <nav
        aria-label="Glossary"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex h-full w-[min(460px,94vw)] flex-col bg-card font-ui shadow-[var(--shadow)] ring-1 ring-rule"
      >
        <div className="flex items-center gap-2 border-b border-rule px-4 pb-3 pt-12">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Glossary · {terms.length} terms</div>
            <div className="truncate text-[14px] font-semibold">{book.title}</div>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOverlay(null)} className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-paper-2">
            <IconX size={16} />
          </button>
        </div>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a term or acronym…"
          className="mx-4 mt-3 rounded-lg bg-paper-2 px-3 py-2 text-[13px] outline-none placeholder:text-ink-3"
        />
        <div className="scroll-quiet mt-2 flex-1 overflow-y-auto px-2 pb-8">
          {terms.length === 0 && <p className="px-3 py-6 text-[13px] text-ink-3">Building the glossary…</p>}
          {shown.map((t) => {
            const first = /^[a-z]/i.test(t.term) ? t.term[0].toUpperCase() : "#";
            const header = first !== letter ? first : null;
            letter = first;
            return (
              <div key={t.key}>
                {header && <div className="sticky top-0 z-10 bg-card px-3 pb-1 pt-3 text-[11px] font-semibold text-accent">{header}</div>}
                <button
                  type="button"
                  onClick={() => {
                    setOverlay(null);
                    setView("clean");
                    jumpTo({ blockId: t.blockId, highlight: t.kind === "acronym" ? t.key : t.term });
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-paper-2"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">{t.term}</span>
                    {t.expansion && <span className="truncate text-[12.5px] text-ink-2">{t.expansion}</span>}
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-3">{pageText(book, t.page, "p.")}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-2">
                    {ai[t.key] ? (
                      <>
                        <IconSparkle size={11} className="mr-1 inline text-accent" />
                        {ai[t.key]}
                      </>
                    ) : (
                      t.definition
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
