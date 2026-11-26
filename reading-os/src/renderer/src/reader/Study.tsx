// Study mode in the page: "Check yourself" at the end of each section, and
// the review of questions that are due again (one book from the reader, every
// book from the library). Answers are graded Again / Hard / Good / Easy and
// scheduled with FSRS.

import { useEffect, useMemo, useState } from "react";
import { nextLabel, type Card, type Grade } from "../../../shared/study/fsrs";
import type { QuestionKind } from "../../../shared/study/questions";
import { useReader } from "../state/reader";
import { useStudy, type Question } from "../state/study";
import { IconCheckCircle, IconX } from "../ui/icons";

const KIND_LABEL: Record<QuestionKind, string> = {
  definition: "Definition",
  acronym: "Abbreviation",
  term: "Key term",
  number: "Number",
  table: "From a table",
  concept: "Concept",
  case: "Patient case",
};

const GRADES: { g: Grade; label: string }[] = [
  { g: 1, label: "Again" },
  { g: 2, label: "Hard" },
  { g: 3, label: "Good" },
  { g: 4, label: "Easy" },
];

/** At the end of a section: a quiet invitation, then the questions. */
export function SectionQuiz({ headingId }: { headingId: string }) {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const all = useStudy((s) => s.questions);
  const reviews = useStudy((s) => s.reviews);
  const busy = useStudy((s) => s.busy);
  const stage = useStudy((s) => s.stage);
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
      {working && <p className="hint working">{stage}</p>}
      {!working && error && !questions.length && <p className="hint">{error}</p>}
      {!working &&
        questions.map((q, i) => (
          <QuestionView
            key={q.id}
            q={q}
            n={i + 1}
            card={reviews[q.id]}
            onGrade={(g, before, first) => void useStudy.getState().grade(q.id, g, before, first)}
            onSource={q.blockId ? () => useReader.getState().jumpTo({ blockId: q.blockId! }) : undefined}
          />
        ))}
    </section>
  );
}

interface QuestionProps {
  q: Question;
  n: number;
  /** The card as it was before this sitting (for the "comes back in…" labels). */
  card: Card | undefined;
  /** `before`: the card as it was when the question was shown; `first`: not a change of mind. */
  onGrade(g: Grade, before: Card | undefined, first: boolean): void;
  onSource?: () => void;
  onDone?: (g: Grade) => void;
  source?: string;
}

export function QuestionView({ q, n, card, onGrade, onSource, onDone, source }: QuestionProps) {
  // The card before this answer, so a change of mind is graded from the same start.
  const [before] = useState(card);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const answered = grade !== null;
  const give = (g: Grade) => {
    const first = grade === null;
    setGrade(g);
    onGrade(g, before, first);
    onDone?.(g);
  };
  const right = picked !== null && picked === q.answer;
  return (
    <div className="question">
      <p className="kind">
        {q.kind ? KIND_LABEL[q.kind] : "Question"}
        {source && <span> · {source}</span>}
      </p>
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
                  // Wrong is Again; right starts as Good and can be changed below.
                  give(i === q.answer ? 3 : 1);
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
            <p className="answer">
              <strong>Answer:</strong> {String(q.answer)}
            </p>
          )}
        </div>
      )}
      {(answered || shown) && q.why && (
        <p className="why">
          “{q.why}”
          {onSource && (
            <button type="button" className="source" onClick={onSource}>
              In the book →
            </button>
          )}
        </p>
      )}
      {/* How well it went decides when it comes back. A wrong pick is simply Again. */}
      {((q.type === "mcq" && right) || (q.type === "short" && shown)) && (
        <div className="grades" role="group" aria-label="How well did you know it?">
          {GRADES.filter((x) => q.type === "short" || x.g > 1).map((x) => (
            <button key={x.g} type="button" className={`grade g${x.g} ${grade === x.g ? "on" : ""}`} onClick={() => give(x.g)}>
              <span>{x.label}</span>
              <span className="when">{nextLabel(before, x.g)}</span>
            </button>
          ))}
        </div>
      )}
      {q.type === "mcq" && picked !== null && !right && <p className="again">Back in {nextLabel(before, 1)}, and again tomorrow.</p>}
    </div>
  );
}

export interface ReviewItem {
  key: string;
  q: Question;
  card: Card | undefined;
  bookTitle?: string;
}

/**
 * Questions that are due, one at a time. Ones you miss come back at the end
 * of the sitting. `onGrade` records an answer; `onGoTo` opens its section.
 */
export function ReviewSession({
  items,
  onGrade,
  onClose,
  onGoTo,
  empty,
}: {
  items: ReviewItem[];
  onGrade(item: ReviewItem, g: Grade, before: Card | undefined, first: boolean): Card;
  onClose(): void;
  onGoTo?: (item: ReviewItem) => void;
  empty: string;
}) {
  // Fixed when the session opens, so answering doesn't reshuffle it.
  const [queue, setQueue] = useState(items);
  const [at, setAt] = useState(0);
  const [answered, setAnswered] = useState<Grade | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [requeued] = useState(() => new Set<string>());
  // The newest card for each question this sitting (a missed one comes back from it).
  const [latest] = useState(() => new Map<string, Card>());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const item = queue[at];
  const next = () => {
    if (answered === 1 && item && !requeued.has(item.key)) {
      requeued.add(item.key);
      setQueue((qs) => [...qs, { ...item, key: `${item.key}~again`, card: latest.get(item.key.replace(/~again$/, "")) ?? item.card }]);
    }
    setTally((t) => (answered === 1 ? { ...t, wrong: t.wrong + 1 } : { ...t, right: t.right + 1 }));
    setAt((n) => n + 1);
    setAnswered(null);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6 font-ui" role="dialog" aria-label="Review" onClick={onClose}>
      <div className="study-card review w-full max-w-[640px]" onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="label">
            <IconCheckCircle size={14} /> Review
          </span>
          <span className="section">{item ? `${Math.min(at + 1, queue.length)} of ${queue.length}` : queue.length ? "Done" : ""}</span>
          <button type="button" aria-label="Close" className="ml-auto text-ink-3 hover:text-ink" onClick={onClose}>
            <IconX size={16} />
          </button>
        </header>
        {queue.length > 0 && <div className="progress" aria-hidden><div style={{ width: `${(at / queue.length) * 100}%` }} /></div>}
        {item ? (
          <>
            <QuestionView
              key={item.key}
              q={item.q}
              n={at + 1}
              card={item.card}
              source={[item.bookTitle, item.q.section].filter(Boolean).join(" · ")}
              onGrade={(g, before, first) => latest.set(item.key.replace(/~again$/, ""), onGrade(item, g, before, first))}
              onDone={(g) => setAnswered(g)}
            />
            <div className="flex justify-between pt-3">
              {onGoTo ? (
                <button type="button" className="text-[12.5px] text-ink-3 hover:text-accent" onClick={() => onGoTo(item)}>
                  Go to the section
                </button>
              ) : (
                <span />
              )}
              {answered !== null && (
                <button type="button" className="next-btn" onClick={next}>
                  {at + 1 < queue.length || answered === 1 ? "Next" : "Finish"}
                </button>
              )}
            </div>
          </>
        ) : queue.length ? (
          <div className="done">
            <p className="big">That’s today’s review.</p>
            <p className="hint">
              {tally.right} right, {tally.wrong} to see again. Each question now comes back just before you’d forget it.
            </p>
            <button type="button" className="next-btn" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <p className="hint py-4">{empty}</p>
        )}
      </div>
    </div>
  );
}

/** The open book's review (Q in the reader). */
export function ReviewSheet() {
  const setOverlay = useReader((s) => s.setOverlay);
  const [items] = useState<ReviewItem[]>(() => {
    const { due, reviews } = useStudy.getState();
    return due().map((q) => ({ key: q.id, q, card: reviews[q.id] }));
  });
  const total = useStudy((s) => s.questions.length);
  return (
    <ReviewSession
      items={items}
      onClose={() => setOverlay(null)}
      onGrade={(it, g, before, first) => useStudy.getState().grade(it.q.id, g, before, first)}
      onGoTo={(it) => {
        setOverlay(null);
        useReader.getState().jumpTo({ blockId: it.q.blockId ?? it.q.sectionId });
      }}
      empty={total ? "All caught up: nothing is due in this book. Questions come back just before you’d forget them." : "No questions yet. Use “Check yourself” at the end of a section."}
    />
  );
}
