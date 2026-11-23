import { useEffect, useState } from "react";
import { platform } from "../platform";
import { useLibrary, type LibraryEntry } from "../state/library";
import { useReader } from "../state/reader";
import { useSettings } from "../state/settings";
import { IconOpen, IconSparkle, IconX } from "../ui/icons";

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function Library({ onOpenFile }: { onOpenFile(): void }) {
  const entries = useLibrary((s) => s.entries);
  const openEntry = useReader((s) => s.openEntry);
  const { model, ollamaUrl } = useSettings();
  const [ai, setAi] = useState<"checking" | "ready" | "missing-model" | "offline">("checking");

  useEffect(() => {
    platform.aiStatus(ollamaUrl).then((r) => {
      if (!r.ok) setAi("offline");
      else setAi(r.models.some((m) => m === model || m.startsWith(`${model}:`)) ? "ready" : "missing-model");
    });
  }, [model, ollamaUrl]);

  return (
    <div className="scroll-quiet h-full overflow-y-auto font-ui">
      <div className="mx-auto max-w-5xl px-8 pb-20 pt-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="m-0 text-[28px] font-semibold tracking-tight">Library</h1>
            <p className="mb-0 mt-1 text-[14px] text-ink-3">PDFs, EPUBs and documents become clean, comfortable books — with an AI reading companion that stays on your computer.</p>
          </div>
          <button
            type="button"
            onClick={onOpenFile}
            className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white shadow-sm hover:brightness-110"
          >
            <IconOpen size={17} /> Open a book
          </button>
        </div>

        <AiChip state={ai} model={model} />

        {entries.length === 0 ? (
          <button
            type="button"
            onClick={onOpenFile}
            className="mt-10 flex h-72 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-rule text-ink-3 hover:border-[var(--accent)] hover:text-ink-2"
          >
            <IconOpen size={30} />
            <span className="text-[16px] font-medium text-ink-2">Drop a book here, or click to choose one</span>
            <span className="max-w-md text-[13px]">PDF, EPUB, Word (.docx), HTML, Markdown or plain text. PDFs are rebuilt into a reflowable book — text, headings, figures, tables and references. Nothing leaves your computer.</span>
          </button>
        ) : (
          <div className="mt-10 grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {entries.map((e) => (
              <BookCard key={e.id} e={e} onOpen={() => void openEntry(e)} onRemove={() => useLibrary.getState().remove(e.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BookCard({ e, onOpen, onRemove }: { e: LibraryEntry; onOpen(): void; onRemove(): void }) {
  const pct = Math.round(e.progress * 100);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col rounded-2xl bg-card p-5 text-left shadow-[var(--shadow)] ring-1 ring-rule transition hover:-translate-y-0.5"
      >
        <div className="mb-4 flex aspect-[3/4] w-full flex-col justify-end rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-[var(--paper-2)] p-4">
          <div className="font-serif text-[19px] font-semibold leading-tight text-ink [font-family:var(--reader-font,'Literata_Variable',serif)]">{e.title}</div>
          <div className="mt-2 text-[11px] text-ink-3">
            {!e.format || e.format === "pdf" ? `${e.pageCount} pages` : `${FORMAT_NAMES[e.format]} · ${Math.max(1, Math.round(e.words / 250 / 60))} h read`} · {e.chapters} chapters
          </div>
        </div>
        <div className="mt-auto">
          <div className="mb-1.5 flex justify-between text-[11.5px] text-ink-3">
            <span>{pct > 0 ? `${pct}% read` : "Not started"}</span>
            <span>{ago(e.openedAt)}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-rule">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
        </div>
      </button>
      <button
        type="button"
        aria-label={`Remove ${e.title} from library`}
        title="Remove from library"
        onClick={onRemove}
        className="absolute right-3 top-3 hidden size-7 place-items-center rounded-full bg-card text-ink-3 shadow ring-1 ring-rule hover:text-ink group-hover:grid"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

function AiChip({ state, model }: { state: "checking" | "ready" | "missing-model" | "offline"; model: string }) {
  const text = {
    checking: "Checking local AI…",
    ready: `Local AI ready · ${model}`,
    "missing-model": `Ollama is running, but ${model} isn't installed. Run: ollama pull ${model}`,
    offline: `Local AI is off. Install Ollama (ollama.com), then run: ollama pull ${model}. Reading works without it.`,
  }[state];
  return (
    <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-paper-2 px-3.5 py-1.5 text-[12.5px] text-ink-2">
      <IconSparkle size={14} className={state === "ready" ? "text-[var(--accent)]" : "text-ink-3"} />
      {text}
    </div>
  );
}

const FORMAT_NAMES: Record<string, string> = { epub: "EPUB", docx: "Word", html: "Web page", markdown: "Markdown", text: "Text", pdf: "PDF" };
