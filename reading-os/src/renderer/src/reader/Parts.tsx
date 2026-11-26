// Each of Kenning's chapters, as a lesson: what it covers before you start
// ("In this part"), and what to keep once you've read it (the summary that
// comes before its quiz).

import { useEffect, useMemo, useRef } from "react";
import type { BookDoc } from "../../../shared/model";
import { extractGlossary, type GlossaryTerm } from "../../../shared/glossary/extract";
import { unitPreview } from "../../../shared/preview";
import type { ReadingUnit } from "../../../shared/units";
import { useGlossary } from "../state/glossary";
import { useParts } from "../state/parts";
import { useReader } from "../state/reader";
import { Title } from "../ui/Title";

const glossaries = new WeakMap<BookDoc, GlossaryTerm[]>();
function termsOf(book: BookDoc, loaded: GlossaryTerm[]): GlossaryTerm[] {
  if (loaded.length) return loaded;
  let t = glossaries.get(book);
  if (!t) glossaries.set(book, (t = extractGlossary(book)));
  return t;
}

/**
 * "In this part": the sections, and the key terms the part introduces.
 * `sections: false` when the chapter opener already lists them.
 */
export function PartPreview({ unit, sections = true }: { unit: ReadingUnit; sections?: boolean }) {
  const book = useReader((s) => s.book)!;
  const loaded = useGlossary((g) => (g.bookId === book.id ? g.terms : EMPTY));
  const p = useMemo(() => unitPreview(book, unit, termsOf(book, loaded)), [book, unit, loaded]);
  const go = (id: string) => useReader.getState().jumpTo({ blockId: id });
  if (!p.terms.length && (!sections || p.sections.length < 2)) return null;
  return (
    <aside className="part-preview font-ui" aria-label="In this part">
      <div className="label">{unit.part ? "In this part" : "In this chapter"}</div>
      {sections && p.sections.length > 1 && (
        <ol className="secs">
          {p.sections.slice(0, 8).map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => go(s.id)}>
                <Title text={s.text} />
              </button>
            </li>
          ))}
          {p.sections.length > 8 && <li className="more">and {p.sections.length - 8} more</li>}
        </ol>
      )}
      {p.terms.length > 0 && (
        <p className="terms">
          <span className="k">Key terms</span>
          {p.terms.map((t) => (
            <button key={t.text} type="button" title={t.definition} onClick={() => go(t.blockId)}>
              {t.text}
            </button>
          ))}
        </p>
      )}
    </aside>
  );
}
const EMPTY: GlossaryTerm[] = [];

/** Before a part's quiz: three points worth keeping, each with the book's own sentence. */
export function PartSummaryCard({ unitId }: { unitId: string }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const unit = ix.units.units.find((u) => u.id === unitId);
  const summary = useParts((s) => s.summaries[unitId]);
  const busy = useParts((s) => s.busy === unitId);
  const done = useParts((s) => s.done[unitId]);
  const ref = useRef<HTMLElement>(null);
  // Written when the reader gets near the end of the part, not before.
  useEffect(() => {
    if (summary || !unit || !ref.current) return;
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void useParts.getState().summarize(book, ix, unit);
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [summary, unit, book, ix]);
  if (!unit || unit.kind !== "read") return null;
  const go = (id: string) => useReader.getState().jumpTo({ blockId: id });
  return (
    <section ref={ref} className="part-summary font-ui" aria-label={`Summary of ${unit.title}`}>
      <header>
        <span className="label">{unit.part ? "This part in three points" : "This chapter in three points"}</span>
        {done && <span className="done">✓ Done</span>}
      </header>
      {!summary ? (
        <p className="hint working">{busy ? "Summing up…" : " "}</p>
      ) : (
        <ol>
          {summary.points.map((p, i) => (
            <li key={i}>
              <p className="point">{p.text}</p>
              {summary.from === "ai" && (
                <button type="button" className="quote" onClick={() => go(p.blockId)} title="Where the book says it">
                  “{p.quote}”
                </button>
              )}
              {summary.from === "book" && (
                <button type="button" className="quote" onClick={() => go(p.blockId)}>
                  In the book →
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
