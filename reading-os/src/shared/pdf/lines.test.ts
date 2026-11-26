import { describe, expect, it } from "vitest";
import type { Run } from "./load.ts";
import { buildLines } from "./lines.ts";

const run = (str: string, x: number, w: number, y = 100, size = 10): Run => ({ str, x, y, w, size, font: "Serif", bold: false, italic: false, rotated: false });

/** Letters set one by one, `track` apart; words `word` apart. */
function tracked(text: string, track: number, word: number): Run[] {
  const out: Run[] = [];
  let x = 50;
  for (const ch of text) {
    if (ch === " ") {
      x += word - track;
      continue;
    }
    out.push(run(ch, x, 6));
    x += 6 + track;
  }
  return out;
}

const textOf = (runs: Run[]) => buildLines({ index: 0, w: 600, h: 800, runs, graphics: [] }, { bodyFont: "Serif", bodySize: 10 })[0].spans.map((s) => s.text).join("");

describe("letter-spaced lines", () => {
  it("joins tracked letters into words", () => {
    expect(textOf(tracked("JEFFREY McCLENDON, JONATHAN B. LEVINE", 3, 9))).toBe("JEFFREY McCLENDON, JONATHAN B. LEVINE");
  });
  it("leaves normal text alone", () => {
    expect(textOf([run("The biologic", 50, 60), run("model", 113, 28)])).toBe("The biologic model");
  });
});
