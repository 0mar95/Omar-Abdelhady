// "Catch me up": opens over the book when you come back to it (or with R /
// ⌘K). A recap of what you have already read, the sections behind you, and
// one button to carry on where you stopped.

import { useEffect, useMemo, useState } from "react";
import { awayFor, type RecapScope } from "../../../shared/recap";
import { useRecap } from "../state/recap";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconCopy, IconRefresh, IconSparkle, IconX } from "../ui/icons";
import { Markdown } from "../ui/markdown";

const SCOPES: { id: RecapScope; label: string }[] = [
  { id: "recent", label: "Where I left off" },
  { id: "chapter", label: "This chapter" },
  { id: "book", label: "Book so far" },
];

function helpFor(error: string, model: string): string {
  if (/failed to fetch|ECONNREFUSED|fetch failed|NetworkError|Load failed/i.test(error))
    return `Ollama isn't running, so there's no recap. Start it, then run “ollama pull ${model}”. The sections below still show where you've been.`;
  return error;
}

export function RecapPanel() {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const awayMs = useReader((s) => s.awayMs);
  const currentBlock = useReader((s) => s.currentBlock);
  const { setOverlay, jumpTo, setView } = useReader.getState();
  const { scope, material, text, status, error } = useRecap();
  const model = useSettings((s) => s.model);
  const [copied, setCopied] = useState(false);

  // Start on the scope a command asked for, or on "where I left off".
  useEffect(() => {
    const st = useRecap.getState();
    const first = st.pending ?? "recent";
    useRecap.setState({ pending: null });
    void st.start(first);
    return () => useRecap.getState().stop();
  }, []);

  const pos = currentBlock ? ix.byId.get(currentBlock) ?? 0 : 0;
  const percent = ix.totalWords ? Math.round((ix.wordsBefore[pos] / ix.totalWords) * 100) : 0;
  const chapter = book.chapters[book.blocks[pos]?.chapter ?? 0];
  const welcome = awayMs !== null && awayMs > 30 * 60 * 1000;

  const subtitle = [
    welcome ? `Last read ${awayFor(awayMs!)} ago` : null,
    `${percent}% through`,
    chapter?.title ? `${chapter.number ? `Chapter ${chapter.number}` : chapter.title}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The outline gets long for "book so far": show the most recent sections.
  const outline = useMemo(() => (material ? material.outline.slice(-6) : []), [material]);
  const hidden = material ? material.outline.length - outline.length : 0;

  const go = (blockId: string) => {
    setOverlay(null);
    setView("clean");
    jumpTo({ blockId });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pb-10 pt-[10vh]" onMouseDown={() => setOverlay(null)}>
      <div className="fixed inset-0 bg-black/25 backdrop-blur-[1px]" />
      <section
        role="dialog"
        aria-label="Catch me up"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-[min(600px,100%)] overflow-hidden rounded-2xl bg-card font-ui text-[var(--card-ink)] shadow-[var(--shadow)] ring-1 ring-rule"
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <IconSparkle size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[16px] font-semibold text-ink">{welcome ? "Welcome back" : "Catch me up"}</h2>
            <p className="m-0 truncate text-[12.5px] text-ink-3" title={book.title}>
              {subtitle}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={() => setOverlay(null)} className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink">
            <IconX size={16} />
          </button>
        </header>

        <div className="flex gap-1 px-5" role="tablist" aria-label="Recap scope">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              onClick={() => scope !== s.id && void useRecap.getState().start(s.id)}
              className={`rounded-full px-3 py-1 text-[12.5px] ${scope === s.id ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="min-h-[96px] px-5 pb-2 pt-4 text-[15px] leading-relaxed" aria-live="polite">
          {status === "empty" ? (
            <p className="m-0 text-[14px] text-ink-3">You've only just started — there's nothing to recap yet.</p>
          ) : status === "error" ? (
            <p className="m-0 text-[14px] text-accent">{helpFor(error ?? "Something went wrong.", model)}</p>
          ) : text ? (
            <Markdown text={text} className={`ai-md ${status === "streaming" ? "caret" : ""}`} />
          ) : (
            <p className="caret m-0 text-[14px] text-ink-3">Looking back over what you've read</p>
          )}
        </div>

        {(status === "done" || status === "error") && text && (
          <div className="flex justify-end gap-0.5 px-4 text-ink-3">
            <SmallButton label="Write it again" onClick={() => void useRecap.getState().start(scope, true)}>
              <IconRefresh size={15} />
            </SmallButton>
            <SmallButton
              label={copied ? "Copied" : "Copy"}
              onClick={() => {
                void navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <IconCopy size={15} />
            </SmallButton>
          </div>
        )}

        {outline.length > 0 && (
          <div className="mx-5 mt-2 border-t border-rule/70 pt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {scope === "recent" ? "Just before that" : "Sections you've read"}
              {hidden > 0 && <span className="font-normal normal-case tracking-normal"> · last {outline.length} of {material!.outline.length}</span>}
            </div>
            <ol className="m-0 list-none p-0">
              {outline.map((o) => (
                <li key={o.blockId}>
                  <button type="button" onClick={() => go(o.blockId)} className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
                    <span className="block truncate text-[12.5px] font-medium text-ink-2">{o.path.split(" › ").slice(-1)[0]}</span>
                    {o.summary && <span className="block text-[12.5px] leading-snug text-ink-3">{o.summary}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {material && (
          <footer className="mt-3 flex items-center gap-3 border-t border-rule/70 bg-paper-2/60 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">You stopped at</div>
              <div className="truncate text-[12.5px] text-ink-2" title={material.stoppedAt.path}>
                {material.stoppedAt.path.split(" › ").slice(-1)[0] || `Page ${book.pages[book.blocks[ix.byId.get(material.stoppedAt.blockId) ?? 0]?.page]?.label ?? ""}`}
                {material.stoppedAt.snippet && <span className="italic text-ink-3"> — “{material.stoppedAt.snippet}”</span>}
              </div>
            </div>
            <button
              type="button"
              autoFocus
              onClick={() => go(material.stoppedAt.blockId)}
              className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white hover:opacity-90"
            >
              Continue reading
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}

function SmallButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="grid size-7 place-items-center rounded-md hover:bg-paper-2 hover:text-ink">
      {children}
    </button>
  );
}
