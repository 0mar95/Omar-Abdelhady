// Minimal Markdown → React for AI answers: paragraphs, bullet and numbered
// lists, **bold**, *italic*, `code`. Text only — never injects HTML.
import type { ReactNode } from "react";

type Cite = (n: number, key: string) => ReactNode;

function inline(text: string, key: string, cite?: Cite): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[\d{1,2}(?:\s*,\s*\d{1,2})*\])/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("[")) {
      const nums = t.slice(1, -1).split(",").map((x) => Number(x.trim()));
      if (cite) nums.forEach((n, j) => out.push(cite(n, `${k}-${j}`)));
      else out.push(t);
    } else if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-paper-2 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className, cite }: { text: string; className?: string; cite?: Cite }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`, cite)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`, cite)}</li>);
    blocks.push(list.ordered ? <ol key={`o${blocks.length}`}>{items}</ol> : <ul key={`u${blocks.length}`}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push(<p key={`h${blocks.length}`}><strong>{inline(heading[1], `h${blocks.length}`, cite)}</strong></p>);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className={className}>{blocks}</div>;
}
