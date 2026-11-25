import { useState } from "react";
import { ACTIONS, useCards, type Card } from "../ai";
import { useSettings } from "../state/settings";
import { Markdown } from "../ui/markdown";
import { IconChevron, IconCopy, IconRefresh, IconStop, IconX } from "../ui/icons";

function helpFor(error: string, model: string): string {
  if (/failed to fetch|ECONNREFUSED|fetch failed|NetworkError|Load failed/i.test(error))
    return `Ollama isn't running. Install it from ollama.com, start it, then run “ollama pull ${model}”.`;
  return error;
}

/** An AI answer shown directly under the paragraph it is about. */
export function InlineCard({ card, onRegenerate }: { card: Card; onRegenerate(card: Card): void }) {
  const { toggle, remove, stop } = useCards.getState();
  const model = useSettings((s) => s.model);
  const [copied, setCopied] = useState(false);
  const streaming = card.status === "streaming";
  const label = card.kind === "ask" ? card.question ?? "Answer" : ACTIONS[card.kind].short;
  return (
    <div className="blk blk-card my-5 font-ui" data-card={card.id}>
      <div className="border-l-2 border-pencil pl-1 text-[15px] text-ink">
        <div className="flex items-center gap-2 px-3 py-1">
          <button
            type="button"
            onClick={() => toggle(card.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={!card.collapsed}
          >
            <IconChevron size={14} className={`shrink-0 text-ink-3 transition-transform ${card.collapsed ? "" : "rotate-90"}`} />
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-pencil">{label}</span>
            <span className="truncate font-title text-[13.5px] italic text-ink-3">“{card.quote.slice(0, 140)}”</span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 text-ink-3">
            {streaming ? (
              <CardButton label="Stop" onClick={() => stop(card.id)}>
                <IconStop size={15} />
              </CardButton>
            ) : (
              <CardButton label="Regenerate" onClick={() => onRegenerate(card)}>
                <IconRefresh size={15} />
              </CardButton>
            )}
            <CardButton
              label={copied ? "Copied" : "Copy"}
              onClick={() => {
                void navigator.clipboard.writeText(card.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <IconCopy size={15} />
            </CardButton>
            <CardButton label="Remove" onClick={() => remove(card.id)}>
              <IconX size={15} />
            </CardButton>
          </div>
        </div>
        {!card.collapsed && (
          <div className="px-3 pt-1 pb-2 font-title text-[17px] leading-[1.6] text-ink-2">
            {card.status === "error" ? (
              <p className="m-0 text-[14px] text-accent">{helpFor(card.error ?? "Something went wrong.", model)}</p>
            ) : card.text ? (
              <Markdown text={card.text} className={`ai-md ${streaming ? "caret" : ""}`} />
            ) : (
              <p className="caret m-0 text-[14px] text-ink-3">Thinking</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CardButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="grid size-7 place-items-center rounded-md hover:bg-paper-2 hover:text-ink">
      {children}
    </button>
  );
}
