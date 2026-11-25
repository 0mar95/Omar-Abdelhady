import { useEffect, useMemo, useRef, useState } from "react";
import { useCards } from "../ai";
import { CommandPalette } from "../command/CommandPalette";
import { platform } from "../platform";
import { useNotes } from "../state/notes";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconLibrary, IconSearch, IconToc, IconType } from "../ui/icons";
import { CleanView } from "./CleanView";
import { Hovercards } from "./Hovercards";
import { GlossarySheet } from "./GlossarySheet";
import { TocSheet, TypePanel } from "./Overlays";
import { ZoomOverlay } from "./Viewers";
import { ReviewSheet } from "./Study";
import { ListenBar } from "./Listen";
import { useListen } from "../state/listen";
import { useStudy } from "../state/study";
import { IconCheckCircle, IconHeadphones } from "../ui/icons";
import { RecapPanel } from "./RecapPanel";
import { openRecap } from "../state/recap";
import { SelectionMenu } from "./SelectionMenu";

const WPM = 230;
const isMac = navigator.platform.toLowerCase().includes("mac");

export function Reader({ onOpenFile, onLibrary }: { onOpenFile(): void; onLibrary(): void }) {
  // No subscription to the reading position here: the title and footer follow
  // it on their own, so scrolling never re-renders the book.
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const overlay = useReader((s) => s.overlay);
  const { setOverlay, setView, jumpTo } = useReader.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [chrome, setChrome] = useState(true);

  useEffect(() => {
    void useCards.getState().load(book.id);
    // Leaving the book stops reading aloud.
    return () => useListen.getState().stop();
  }, [book.id]);

  // Bars fade away while reading forward, come back on scroll up or near the
  // top edge, and fade again after a few quiet seconds.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastY = el.scrollTop;
    let lastPing = 0;
    let idle = 0;
    let atTop = false;
    const later = () => {
      clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (el.scrollTop >= 80 && !atTop) setChrome(false);
      }, 3000);
    };
    const onScroll = () => {
      const y = el.scrollTop;
      if (y < 80) setChrome(true);
      else if (y < lastY - 8) (setChrome(true), later());
      else if (y > lastY + 8) setChrome(false);
      lastY = y;
      // Tell the background worker to hold off while scrolling (see main).
      const now = performance.now();
      if (now - lastPing > 400) {
        lastPing = now;
        platform.readerActivity();
      }
    };
    const onMove = (e: MouseEvent) => {
      atTop = e.clientY < 64 || e.clientY > window.innerHeight - 40;
      if (atTop) setChrome(true);
      else later();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onMove);
    return () => {
      clearTimeout(idle);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // Keyboard: ⌘K palette, T contents, G glossary, R recap, [ ] chapters, ⌘+/⌘- size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay(useReader.getState().overlay === "palette" ? null : "palette");
        return;
      }
      if (e.key === "Escape" && useReader.getState().overlay) {
        setOverlay(null);
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        useSettings.getState().set({ size: Math.min(28, useSettings.getState().size + 1) });
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        useSettings.getState().set({ size: Math.max(14, useSettings.getState().size - 1) });
        return;
      }
      if (typing || mod || e.altKey || useReader.getState().overlay) return;
      // preventDefault keeps the letter out of the filter box the overlay focuses.
      if (e.key === "t") {
        e.preventDefault();
        setOverlay("toc");
      } else if (e.key === "g") {
        e.preventDefault();
        setOverlay("glossary");
      } else if (e.key === "l") {
        e.preventDefault();
        useListen.getState().toggle();
      } else if (e.key === "q") {
        e.preventDefault();
        setOverlay("review");
      } else if (e.key === "f") {
        e.preventDefault();
        useSettings.getState().set({ focus: !useSettings.getState().focus });
      } else if (e.key === "r") {
        e.preventDefault();
        openRecap();
      } else if (e.key === "]" || e.key === "[") {
        const cur = ix.byId.get(useReader.getState().currentBlock ?? "") ?? 0;
        const ch = book.blocks[cur]?.chapter ?? 0;
        // "[" goes to the start of this chapter, or the previous one if already there.
        const next = e.key === "]" ? ch + 1 : cur > book.chapters[ch].start + 1 ? ch : ch - 1;
        const target = book.chapters[Math.max(0, Math.min(book.chapters.length - 1, next))];
        const b = target && book.blocks[target.start];
        if (b) jumpTo({ blockId: b.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, ix, setOverlay, setView, jumpTo]);


  const showChrome = chrome || !!overlay;
  return (
    <div className="relative h-full">
      <header
        className={`fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-1 border-b border-rule/70 bg-paper px-3 font-ui duration-300 [-webkit-app-region:drag] ${showChrome ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"} transition-[transform,opacity] ${isMac && window.readingOS ? "pl-20" : ""}`}
      >
        <BarButton label="Library" onClick={onLibrary}>
          <IconLibrary />
        </BarButton>
        <BarButton label="Contents (T)" onClick={() => setOverlay("toc")}>
          <IconToc />
        </BarButton>
        <ReaderTitle />
        <button
          type="button"
          onClick={() => setOverlay("palette")}
          className="mr-1 hidden items-center gap-2 rounded-full px-3 py-1.5 text-[12px] text-ink-3 ring-1 ring-rule hover:text-ink sm:flex [-webkit-app-region:no-drag]"
        >
          <IconSearch size={14} /> Search or ask
          <kbd className="rounded border border-rule px-1 text-[10.5px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <BarButton label="Listen (L)" onClick={() => useListen.getState().toggle()}>
          <IconHeadphones size={18} />
        </BarButton>
        <ReviewButton />
        <BarButton label="Reading settings" onClick={() => setOverlay(overlay === "type" ? null : "type")}>
          <IconType />
        </BarButton>
      </header>

      <div ref={scrollRef} className="scroll-quiet h-full overflow-y-auto" data-testid="reader-scroll">
        <CleanView scrollRef={scrollRef} />
      </div>

      <ReaderFooter visible={showChrome} />
      <ChapterRail />

      <SelectionMenu scrollRoot={scrollRef} />
      <Hovercards root={scrollRef} />
      {overlay === "toc" && <TocSheet />}
      {overlay === "glossary" && <GlossarySheet />}
      {overlay === "type" && <TypePanel />}
      {overlay === "recap" && <RecapPanel />}
      {overlay === "review" && <ReviewSheet />}
      <ListenBar />
      {overlay === "palette" && <CommandPalette onOpenFile={onOpenFile} onLibrary={onLibrary} />}
      <ZoomOverlay />
    </div>
  );
}

/** Questions due for review: a quiet count in the top bar. */
function ReviewButton() {
  const reviews = useStudy((s) => s.reviews);
  const questions = useStudy((s) => s.questions);
  const due = useMemo(() => {
    const now = Date.now();
    return questions.filter((q) => reviews[q.id] && reviews[q.id].due <= now).length;
  }, [reviews, questions]);
  if (!questions.length) return null;
  return (
    <button
      type="button"
      title={due ? `${due} question${due === 1 ? "" : "s"} to review (Q)` : "Review (Q)"}
      aria-label="Review"
      onClick={() => useReader.getState().setOverlay("review")}
      className="relative grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2 hover:text-ink [-webkit-app-region:no-drag]"
    >
      <IconCheckCircle size={18} />
      {due > 0 && <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-[var(--accent)] px-1 text-center text-[10px] font-semibold leading-[16px] text-white">{due}</span>}
    </button>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-paper-2 hover:text-ink [-webkit-app-region:no-drag]"
    >
      {children}
    </button>
  );
}


/** Where the reader is, from the current block: chapter, progress, time left. */
function useProgress() {
  const book = useReader((s) => s.book)!;
  const ix = useReader((s) => s.ix)!;
  const currentBlock = useReader((s) => s.currentBlock);
  return useMemo(() => {
    const i = currentBlock ? ix.byId.get(currentBlock) ?? 0 : 0;
    const b = book.blocks[i];
    const ch = book.chapters[b?.chapter ?? 0];
    const chEnd = Math.min(ch?.end ?? book.blocks.length, book.blocks.length);
    const chWordsEnd = chEnd < book.blocks.length ? ix.wordsBefore[chEnd] : ix.totalWords;
    const wordsLeft = chWordsEnd - ix.wordsBefore[i];
    const chStart = ix.wordsBefore[ch?.start ?? 0] ?? 0;
    return {
      chapterPct: chWordsEnd > chStart ? Math.min(100, Math.max(0, ((ix.wordsBefore[i] - chStart) / (chWordsEnd - chStart)) * 100)) : 0,
      chapter: ch,
      percent: ix.totalWords ? Math.round((ix.wordsBefore[i] / ix.totalWords) * 100) : 0,
      minutesLeft: Math.max(0, Math.round(wordsLeft / WPM)),
      page: b ? book.pages[b.page]?.label : "",
    };
  }, [currentBlock, book, ix]);
}

function ReaderTitle() {
  const title = useReader((s) => s.book!.title);
  const { chapter } = useProgress();
  // Front matter is often "chapter 0" named after the book itself: don't repeat it.
  const same = chapter?.title && chapter.title.trim().toLowerCase() === title.trim().toLowerCase();
  return (
    <div className="mx-2 min-w-0 flex-1 truncate text-center text-[12.5px]">
      <span className="font-title text-[14.5px] tracking-[0.04em] text-ink [font-variant:small-caps]">{title.toLowerCase()}</span>
      {chapter?.title && !same && (
        <span className="text-ink-3">
          {" "}
          · {chapter.number ? `${chapter.number}. ` : ""}
          {chapter.title}
        </span>
      )}
    </div>
  );
}

function ChapterRail() {
  const { chapter, chapterPct } = useProgress();
  if (!chapter) return null;
  return (
    <div className="chapter-rail" title={`${chapter.title} · ${Math.round(chapterPct)}% read`} aria-hidden>
      <div style={{ height: `${chapterPct}%` }} />
    </div>
  );
}

function ReaderFooter({ visible }: { visible: boolean }) {
  const info = useProgress();
  return (
    <footer
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-20 font-ui transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <div className="flex items-center justify-between px-5 pb-2 text-[11.5px] tabular-nums text-ink-3">
        <span>
          {info.minutesLeft > 0 ? `${info.minutesLeft} min left in chapter` : "End of chapter"}
        </span>
        <span>
          <IndexProgress />
          {info.percent}%
        </span>
      </div>
      <div className="h-[2px] bg-rule/60">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${info.percent}%` }} />
      </div>
    </footer>
  );
}

/** "Preparing search 40% ·" while the book is being embedded in the background. */
function IndexProgress() {
  const st = useNotes((n) => n.status);
  if (!st || st.state !== "embedding" || !st.chunks) return null;
  return <span className="mr-2">Preparing search {Math.round((st.embedded / st.chunks) * 100)}% ·</span>;
}
