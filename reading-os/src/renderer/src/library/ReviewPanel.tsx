// The library's "Review today": questions due across every book, the streak,
// and one sitting that goes through them all.

import { useEffect, useState } from "react";
import type { LibraryEntry } from "../state/library";
import { useReader } from "../state/reader";
import { dueAcross, gradeIn, streak, type DueItem } from "../state/study";
import { ReviewSession, type ReviewItem } from "../reader/Study";

export function ReviewPanel({ entries }: { entries: LibraryEntry[] }) {
  const [due, setDue] = useState<DueItem[] | null>(null);
  const [days, setDays] = useState(0);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const key = entries.map((e) => e.id).join(",");
  useEffect(() => {
    let live = true;
    void dueAcross(entries.map((e) => ({ id: e.id, title: e.title }))).then((d) => live && setDue(d));
    void streak().then((s) => live && setDays(s.days));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  if (!due) return null;
  const books = new Map<string, number>();
  for (const d of due) books.set(d.bookTitle, (books.get(d.bookTitle) ?? 0) + 1);
  const from = [...books].map(([t, n]) => `${t} (${n})`);
  const minutes = Math.max(1, Math.round((due.length * 20) / 60));
  return (
    <section aria-label="Review today" className="review-panel">
      <p className="label">Review today</p>
      {due.length ? (
        <>
          <p className="count">
            {due.length} <span>{due.length === 1 ? "question" : "questions"}</span>
          </p>
          <p className="from">
            From {from.length > 2 ? `${from.slice(0, 2).join(", ")} and ${from.length - 2} more` : from.join(" and ")}. About {minutes} {minutes === 1 ? "minute" : "minutes"}.
          </p>
          <button type="button" className="start" onClick={() => setOpen(true)}>
            Start review
          </button>
        </>
      ) : (
        <p className="from">All caught up. Questions from “Check yourself” come back here just before you’d forget them.</p>
      )}
      {days > 0 && <p className="streak">{days === 1 ? "1 day" : `${days} days`} in a row</p>}
      {open && (
        <ReviewSession
          items={due.map<ReviewItem>((d) => ({ key: `${d.bookId}:${d.q.id}`, q: d.q, card: d.card, bookTitle: d.bookTitle }))}
          onGrade={(it, g, before, first) => gradeIn(it.key.slice(0, it.key.indexOf(":")), it.q.id, g, before, first)}
          onGoTo={(it) => {
            const entry = entries.find((e) => it.key.startsWith(`${e.id}:`));
            setOpen(false);
            if (entry) void useReader.getState().openEntry(entry).then(() => useReader.getState().jumpTo({ blockId: it.q.blockId ?? it.q.sectionId }));
          }}
          onClose={() => {
            setOpen(false);
            setTick((t) => t + 1);
          }}
          empty="Nothing is due."
        />
      )}
    </section>
  );
}
