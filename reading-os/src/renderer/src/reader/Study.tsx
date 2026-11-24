// Study mode in the page: "Check yourself" at the end of each section, and
// the review of questions that are due again.

import { useEffect, useMemo, useState } from "react";
import { useReader } from "../state/reader";
import { useStudy, type Question } from "../state/study";
import { IconCheckCircle, IconX } from "../ui/icons";

/** At the end of a section: a quiet invitation, then the questions. */
export function SectionQuiz({ headingId }: { headingId: string }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const all = useStudy((s) => s.questions);
  const busy = useStudy((s) => s.busy);
  const error = useStudy((s) => s.error);
  const [open, setOpen] = useState(false);
  const questions = useMemo(() => all.filter((q) => q.sectionId === headingId), [all, headingId]);
  const title = book.blocks[ix.byId.get(headingId) ?? 0];
  const name = title?.kind === "heading" ? title.text : "this section";
  const working = busy === headingId;

  if (!open && !questions.length)
    return (
      <div className="study-invite font-ui">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            void useStudy.getState().generate(book, ix, headingId);
          }}
          disabled={!!busy}
        >
          <IconCheckCircle size={15} /> Check yourself on “{name}”
        </button>
      </div>
    );
  return (
    <section className="study-card font-ui" aria-label={`Questions on ${name}`}>
      <header>
        <span className="label">
          <IconCheckCircle size={14} /> Check yourself
        </span>
        <span className="section">{name}</span>
        {questions.length > 0 && !working && (
          <button type="button" className="ml-auto text-ink-3 hover:text-ink" onClick={() => void useStudy.getState().generate(book, ix, headingId)}>
            New questions
          </button>
        )}
      </header>
      {working && <p className="hint">Writing questions from this section…</p>}
      {!working && error && !questions.length && <p className="hint">{error}</p>}
      {questions.map((q, i) => (
        <QuestionView key={q.id} q={q} n={i + 1} />
      ))}
    </section>
  );
}

export function QuestionView({ q, n, onDone }: { q: Question; n: number; onDone?: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(false);
  const [graded, setGraded] = useState(false);
  const grade = (right: boolean) => {
    if (graded) return;
    setGraded(true);
    useStudy.getState().grade(q.id, right);
    onDone?.();
  };
  return (
    <div className="question">
      <p className="q">
        <span className="n">{n}</span>
        {q.q}
      </p>
      {q.type === "mcq" && q.options ? (
        <div className="options">
          {q.options.map((o, i) => {
            const state = picked === null ? "" : i === q.answer ? "right" : i === picked ? "wrong" : "dim";
            return (
              <button
                key={i}
                type="button"
                className={`option ${state}`}
                disabled={picked !== null}
                onClick={() => {
                  setPicked(i);
                  grade(i === q.answer);
                }}
              >
                <span className="letter">{String.fromCharCode(65 + i)}</span>
                {o}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="short">
          {!shown ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setShown(true);
              }}
            >
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Your answer (or just think it)…" />
              <button type="submit">Show answer</button>
            </form>
          ) : (
            <>
              <p className="answer">
                <strong>Answer:</strong> {String(q.answer)}
              </p>
              {!graded && (
                <div className="self">
                  <button type="button" className="right" onClick={() => grade(true)}>
                    I had it
                  </button>
                  <button type="button" className="wrong" onClick={() => grade(false)}>
                    I missed it
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {(picked !== null || graded) && q.why && <p className="why">{q.why}</p>}
    </div>
  );
}

/** The questions that are due again, one at a time. */
export function ReviewSheet() {
  const setOverlay = useReader((s) => s.setOverlay);
  const reviews = useStudy((s) => s.reviews);
  const questions = useStudy((s) => s.questions);
  // Fixed when the sheet opens, so answering doesn't reshuffle the queue.
  const [queue] = useState(() => useStudy.getState().due());
  const [at, setAt] = useState(0);
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOverlay(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOverlay]);
  const total = questions.length;
  const learned = Object.values(reviews).filter((r) => r.last === "right").length;
  const q = queue[at];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6 font-ui" role="dialog" aria-label="Review" onClick={() => setOverlay(null)}>
      <div className="study-card review w-full max-w-[640px]" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="label">
            <IconCheckCircle size={14} /> Review
          </span>
          <span className="section">
            {q ? `${at + 1} of ${queue.length} due` : `${learned} of ${total} questions answered right last time`}
          </span>
          <button type="button" aria-label="Close" className="ml-auto text-ink-3 hover:text-ink" onClick={() => setOverlay(null)}>
            <IconX size={16} />
          </button>
        </header>
        {q ? (
          <>
            <p className="hint">From “{q.section}”</p>
            <QuestionView key={q.id} q={q} n={at + 1} onDone={() => setAnswered(true)} />
            <div className="flex justify-between pt-2">
              <button
                type="button"
                className="text-[12.5px] text-ink-3 hover:text-accent"
                onClick={() => {
                  setOverlay(null);
                  useReader.getState().jumpTo({ blockId: q.sectionId });
                }}
              >
                Go to the section
              </button>
              {answered && (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white"
                  onClick={() => {
                    setAt((n) => n + 1);
                    setAnswered(false);
                  }}
                >
                  {at + 1 < queue.length ? "Next" : "Finish"}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="hint py-4">
            {total ? "All caught up — nothing is due. Questions you miss come back the next day; ones you get right come back later and later." : "No questions yet. Use “Check yourself” at the end of a section."}
          </p>
        )}
      </div>
    </div>
  );
}
