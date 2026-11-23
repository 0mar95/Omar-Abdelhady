// AI margin notes: a one-line summary and key concepts beside each section.
// In the margin on wide windows; as a quiet line under the heading otherwise.

import type { MarginNote as Note } from "../../../shared/ipc";
import { useReader } from "../state/reader";
import { IconSparkle } from "../ui/icons";

function searchFor(concept: string) {
  useReader.getState().openPalette(concept);
}

function Concepts({ note }: { note: Note }) {
  if (!note.concepts.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {note.concepts.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => searchFor(c)}
          title={`Search the book for “${c}”`}
          className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] leading-tight text-ink-2 ring-1 ring-rule/70 hover:bg-accent-soft hover:text-ink"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/** Zero-height anchor before a heading; the note hangs in the right margin. */
export function GutterNote({ note, working, level }: { note?: Note; working: boolean; level: number }) {
  if (!note && !working) return null;
  return (
    <div className="note-anchor" aria-hidden={!note}>
      <aside aria-label="Margin note" className={`margin-note lvl-${level} font-ui`} data-note={note?.blockId}>
        {note ? (
          <>
            <div className="flex gap-1.5 text-[12.5px] leading-snug text-ink-2">
              <IconSparkle size={12} className="mt-[3px] shrink-0 text-accent opacity-80" />
              <span>{note.summary}</span>
            </div>
            <Concepts note={note} />
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <IconSparkle size={12} className="animate-pulse text-accent" /> Summarizing this section…
          </div>
        )}
      </aside>
    </div>
  );
}

/** Narrow windows: the note sits under the heading as a single quiet line. */
export function InlineNote({ note }: { note?: Note }) {
  if (!note) return null;
  return (
    <div className="blk blk-note -mt-1 mb-4 font-ui" data-note={note.blockId}>
      <div className="flex gap-1.5 text-[13px] leading-snug text-ink-3">
        <IconSparkle size={12} className="mt-[3px] shrink-0 text-accent opacity-80" />
        <span>{note.summary}</span>
      </div>
      <Concepts note={note} />
    </div>
  );
}
