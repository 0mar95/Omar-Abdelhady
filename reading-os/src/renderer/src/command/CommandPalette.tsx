// ⌘K: search the book or the whole library (exact words + meaning), jump to
// sections, figures and tables, run commands, or ask a question and get an
// answer with sources you can jump to.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "../../../shared/ipc";
import { spansText } from "../../../shared/model";
import { useCards } from "../ai";
import type { ChatHandle } from "../platform";
import { askBooks, searchBooks } from "../search";
import { useGlossary } from "../state/glossary";
import { useLibrary } from "../state/library";
import { pageText, useReader } from "../state/reader";
import { useSettings, type Theme } from "../state/settings";
import { IconBook, IconChevron, IconCopy, IconImage, IconList, IconPage, IconSearch, IconSparkle, IconToc, IconType } from "../ui/icons";
import { Markdown } from "../ui/markdown";

interface Item {
  id: string;
  group: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ReactNode;
  run(): void;
}

interface Answer {
  question: string;
  text: string;
  sources: SearchHit[];
  status: "searching" | "streaming" | "done" | "error";
  error?: string;
}

/** Renders a snippet whose matches are wrapped in \u0001…\u0002. */
export function Marked({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("\u0001") ? (
          <mark key={i} className="rounded-[3px] bg-[var(--highlight)] px-0.5 text-inherit">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function shortSection(s: string): string {
  const parts = s.split(" › ");
  return parts.length > 2 ? `${parts[0]} › … › ${parts[parts.length - 1]}` : s;
}

export function CommandPalette({ onOpenFile, onLibrary }: { onOpenFile(): void; onLibrary(): void }) {
  const book = useReader((s) => s.book);
  const ix = useReader((s) => s.ix);
  const currentBlock = useReader((s) => s.currentBlock);
  const spoilerLimit = useSettings((s) => s.spoilerLimit);
  const { setOverlay, jumpTo, setView } = useReader.getState();
  const [q, setQ] = useState(() => useReader.getState().paletteQuery);
  const [sel, setSel] = useState(0);
  const [scope, setScope] = useState<"book" | "library">(book ? "book" : "library");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const handle = useRef<ChatHandle | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => setOverlay(null);
  const bookScope = scope === "book" && !!book;
  const maxBlock = bookScope && spoilerLimit && currentBlock && ix ? ix.byId.get(currentBlock) : undefined;

  useEffect(() => () => handle.current?.abort(), []);

  // Search as you type (debounced).
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await searchBooks({ q: query, bookId: bookScope ? book!.id : undefined, maxBlock, limit: 24 });
      if (alive) {
        setHits(r);
        setSearching(false);
      }
    }, 140);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, bookScope, book, maxBlock]);

  const goTo = (h: SearchHit) => {
    close();
    const query = q.trim();
    if (book && h.bookId === book.id) {
      setView("clean");
      jumpTo({ blockId: h.blockId, highlight: query });
      return;
    }
    const entry = useLibrary.getState().entries.find((e) => e.id === h.bookId);
    if (entry)
      void useReader
        .getState()
        .openEntry(entry)
        .then(() => useReader.getState().jumpTo({ blockId: h.blockId, highlight: query }));
  };

  const ask = () => {
    const question = q.trim();
    if (!question) return;
    handle.current?.abort();
    setAnswer({ question, text: "", sources: [], status: "searching" });
    const h = askBooks(
      question,
      { bookId: bookScope ? book!.id : undefined, maxBlock },
      {
        sources: (sources) => setAnswer((a) => (a ? { ...a, sources, status: "streaming" } : a)),
        text: (t) => setAnswer((a) => (a ? { ...a, text: a.text + t } : a)),
      },
    );
    handle.current = h;
    h.done
      .then(() => setAnswer((a) => (a ? { ...a, status: "done" } : a)))
      .catch((e: unknown) => setAnswer((a) => (a ? { ...a, status: "error", error: e instanceof Error ? e.message : String(e) } : a)));
  };

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    const out: Item[] = [];
    const commands: Item[] = [
      { id: "c-open", group: "Commands", title: "Open a book…", icon: <IconPage />, run: onOpenFile },
      { id: "c-lib", group: "Commands", title: "Go to library", icon: <IconBook />, run: onLibrary },
    ];
    if (book)
      commands.push(
        { id: "c-toc", group: "Commands", title: "Table of contents", icon: <IconToc />, run: () => setOverlay("toc") },
        { id: "c-glossary", group: "Commands", title: "Glossary (A–Z)", icon: <IconList />, run: () => setOverlay("glossary") },
        { id: "c-type", group: "Commands", title: "Reading settings (font, size, theme, AI)", icon: <IconType />, run: () => setOverlay("type") },
        {
          id: "c-view",
          group: "Commands",
          title: useReader.getState().view === "clean" ? "Switch to original pages" : "Switch to clean reading view",
          icon: <IconPage />,
          run: () => setView(useReader.getState().view === "clean" ? "page" : "clean"),
        },
        {
          id: "c-notes",
          group: "Commands",
          title: useSettings.getState().marginNotes ? "Hide margin notes" : "Show margin notes",
          icon: <IconSparkle />,
          run: () => useSettings.getState().set({ marginNotes: !useSettings.getState().marginNotes }),
        },
      );
    for (const t of ["light", "sepia", "dark", "black"] as Theme[])
      commands.push({ id: `c-theme-${t}`, group: "Commands", title: `Theme: ${t[0].toUpperCase()}${t.slice(1)}`, icon: <IconType />, run: () => useSettings.getState().set({ theme: t }) });
    if (!query) return commands;

    out.push({
      id: "ask",
      group: "Ask",
      title: <>Ask: “{q.trim()}”</>,
      detail: bookScope
        ? maxBlock !== undefined
          ? "Answer from this book using only what you've read so far, with sources"
          : "Answer from this book, with sources"
        : "Answer from your whole library, with sources",
      icon: <IconSparkle />,
      run: ask,
    });
    out.push(...commands.filter((c) => terms.every((t) => String(c.title).toLowerCase().includes(t))));
    if (book) {
      // Glossary: the book's own definitions, shown right in the list.
      const g = useGlossary.getState();
      let n = 0;
      for (const t of g.terms) {
        const hay = `${t.term} ${t.expansion ?? ""}`.toLowerCase();
        if (!terms.every((w) => hay.includes(w))) continue;
        const def = g.ai[t.key] ?? t.definition;
        out.push({
          id: `g-${t.key}`,
          group: "Glossary",
          title: (
            <>
              <span className="font-semibold">{t.term}</span>
              {t.expansion && <span className="text-ink-2"> · {t.expansion}</span>}
            </>
          ),
          detail: def.length > 150 ? `${def.slice(0, 150)}…` : def,
          icon: <IconSparkle />,
          run: () => {
            setView("clean");
            jumpTo({ blockId: t.blockId, highlight: t.kind === "acronym" ? t.key : t.term });
          },
        });
        if (++n >= 4) break;
      }
    }
    if (bookScope && book && ix) {
      let n = 0;
      for (const t of book.toc) {
        if (!terms.every((w) => t.title.toLowerCase().includes(w))) continue;
        out.push({
          id: `t-${t.id}`,
          group: "Sections",
          title: t.title,
          detail: pageText(book, t.page),
          icon: <IconList />,
          run: () => {
            setView("clean");
            jumpTo({ blockId: t.blockId });
          },
        });
        if (++n >= 6) break;
      }
      n = 0;
      for (const b of book.blocks) {
        if ((b.kind !== "figure" && b.kind !== "table" && b.kind !== "box") || !b.key) continue;
        const caption = (b.kind === "box" ? spansText(b.title) : spansText(b.caption)).replace(new RegExp(`^\\s*${b.key.replace(/[-]/g, "\\s*-\\s*")}\\s*`), "");
        const text = `${b.key} ${caption} ${b.kind === "figure" ? b.labels ?? "" : ""}`.toLowerCase();
        if (!terms.every((w) => text.includes(w))) continue;
        out.push({
          id: `f-${b.id}`,
          group: "Figures, tables & boxes",
          title: `${b.key} · ${caption.slice(0, 100)}`,
          detail: pageText(book, b.page),
          icon: <IconImage />,
          run: () => {
            setView("clean");
            jumpTo({ blockId: b.id });
          },
        });
        if (++n >= 5) break;
      }
    }
    const group = bookScope ? "In this book" : "In your library";
    for (const h of hits) {
      const page = book && h.bookId === book.id ? pageText(book, h.page) : h.bookTitle;
      out.push({
        id: `h-${h.bookId}-${h.chunkId}`,
        group,
        title: <Marked text={h.snippet} />,
        detail: (
          <>
            {h.match === "meaning" && (
              <span
                title="Found by meaning: the passage doesn't contain your exact words"
                className="mr-1.5 rounded bg-accent-soft px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-accent"
              >
                related
              </span>
            )}
            {shortSection(h.section)} · {page}
          </>
        ),
        icon: <IconSearch />,
        run: () => goTo(h),
      });
    }
    return out;
  }, [q, hits, book, ix, bookScope, maxBlock]);

  useEffect(() => setSel(0), [q, scope]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (i: Item | undefined) => {
    if (!i) return;
    if (i.id === "ask") {
      i.run();
      return;
    }
    close();
    i.run();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/25 pt-[10vh] backdrop-blur-[2px]" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-fit max-h-[76vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-2xl bg-card font-ui shadow-[0_24px_80px_rgb(0_0_0/0.3)] ring-1 ring-rule"
      >
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <IconSearch className="text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (answer) {
                handle.current?.abort();
                setAnswer(null);
              }
            }}
            onKeyDown={(e) => {
              if (answer) {
                if (e.key === "Escape") close();
                return;
              }
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
            placeholder={book ? "Search the book, jump to a section, or ask a question…" : "Search your library or ask a question…"}
            className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          {searching && <span className="text-[11px] text-ink-3">searching…</span>}
          <kbd className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-3">esc</kbd>
        </div>

        <div className="flex items-center gap-3 border-b border-rule/70 px-4 py-2 text-[12px]">
          {book && (
            <div className="flex rounded-lg bg-paper-2 p-0.5" role="group" aria-label="Search scope">
              {(["book", "library"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className={`rounded-md px-2.5 py-1 ${scope === s ? "bg-card font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
                >
                  {s === "book" ? "This book" : "All books"}
                </button>
              ))}
            </div>
          )}
          {bookScope && (
            <label className="flex cursor-pointer items-center gap-1.5 text-ink-2" title="Search results and answers only use the book up to where you are, so nothing ahead is spoiled.">
              <input type="checkbox" checked={spoilerLimit} onChange={(e) => useSettings.getState().set({ spoilerLimit: e.target.checked })} className="size-3.5 accent-[var(--accent)]" />
              Only what I've read
            </label>
          )}
          <span className="ml-auto text-ink-3">↵ open · ↑↓ move</span>
        </div>

        {answer ? (
          <AnswerView answer={answer} onBack={() => setAnswer(null)} onSource={goTo} bookId={book?.id} />
        ) : (
          <div ref={listRef} className="scroll-quiet overflow-y-auto py-2">
            {q.trim() && items.length <= 1 && !searching && <div className="px-5 py-3 text-[12.5px] text-ink-3">No matches yet — try “Ask” for an answer drawn from the book.</div>}
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
        )}
      </div>
    </div>
  );
}

function AnswerView({ answer, onBack, onSource, bookId }: { answer: Answer; onBack(): void; onSource(h: SearchHit): void; bookId?: string }) {
  const book = useReader((s) => s.book);
  const [copied, setCopied] = useState(false);
  const streaming = answer.status === "searching" || answer.status === "streaming";
  const pin = () => {
    const at = useReader.getState().currentBlock;
    if (!at) return;
    const sources = answer.sources.map((s, i) => `[${i + 1}] ${shortSection(s.section)}`).join(" · ");
    useCards.getState().pin(at, answer.question, `${answer.text}\n\n_Sources: ${sources}_`);
    useReader.getState().setOverlay(null);
  };
  return (
    <div className="scroll-quiet overflow-y-auto px-5 pb-5 pt-3" data-testid="answer">
      <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
        <IconChevron size={12} className="rotate-180" /> Results
      </button>
      <div className="mb-3 flex items-start gap-2">
        <IconSparkle size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="text-[15px] font-semibold leading-snug text-ink">{answer.question}</div>
      </div>
      <div className="text-[14.5px] leading-relaxed text-[var(--card-ink)]">
        {answer.status === "searching" ? (
          <p className="caret m-0 text-ink-3">Finding passages</p>
        ) : answer.status === "error" ? (
          <p className="m-0 text-accent">
            {/fetch|ECONNREFUSED|NetworkError/i.test(answer.error ?? "") ? "Ollama isn't running. Start it to get answers; search results still work." : answer.error}
          </p>
        ) : (
          <Markdown
            text={answer.text || " "}
            className={`ai-md ${streaming ? "caret" : ""}`}
            cite={(n, key) => {
              const src = answer.sources[n - 1];
              return src ? (
                <button
                  key={key}
                  type="button"
                  title={shortSection(src.section)}
                  onClick={() => onSource(src)}
                  className="mx-0.5 inline-grid h-[1.35em] min-w-[1.35em] place-items-center rounded-md bg-accent-soft px-1 align-[0.1em] text-[0.72em] font-semibold text-accent hover:bg-[var(--accent)] hover:text-white"
                >
                  {n}
                </button>
              ) : null;
            }}
          />
        )}
      </div>
      {answer.sources.length > 0 && (
        <div className="mt-4 border-t border-rule pt-3">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Sources</div>
          <ol className="m-0 list-none space-y-1 p-0">
            {answer.sources.map((s, i) => (
              <li key={s.chunkId}>
                <button type="button" onClick={() => onSource(s)} className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-paper-2">
                  <span className="w-4 shrink-0 text-right text-[12px] font-semibold text-accent">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                    <span className="text-ink">{shortSection(s.section)}</span>
                    <span className="text-ink-3">
                      {" "}
                      {book && s.bookId === book.id ? (pageText(book, s.page) ? ` · ${pageText(book, s.page)}` : "") : ` · ${s.bookTitle}`}
                    </span>
                    <span className="block truncate text-ink-3">{s.text.slice(0, 160)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {answer.status === "done" && (
        <div className="mt-3 flex gap-2 text-[12px]">
          {bookId && (
            <button type="button" onClick={pin} className="rounded-lg bg-paper-2 px-3 py-1.5 text-ink-2 hover:text-ink">
              Keep on the page
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(answer.text);
              setCopied(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-paper-2 px-3 py-1.5 text-ink-2 hover:text-ink"
          >
            <IconCopy size={13} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
