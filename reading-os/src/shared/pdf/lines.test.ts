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

describe("letter-spaced text stored with spaces", () => {
  it("closes up letters stored with spaces between them", () => {
    expect(textOf([run("J E F F R E Y", 50, 44), run("Mc", 100, 12), run("C L E N D O N ,", 113, 56), run("J O N A T H A N", 176, 60)])).toBe("JEFFREY McCLENDON, JONATHAN");
  });
});

describe("letter-spaced labels", () => {
  it("keeps the break before a number and wider gaps", () => {
    expect(textOf([run("C h a p t e r 3", 50, 80)])).toBe("Chapter 3");
    expect(textOf([run("T H E  B I O L O G I C  M O D E L", 50, 120)])).toBe("THE BIOLOGIC MODEL");
  });
});

describe("letter-spaced lines with stray letters", () => {
  it("joins single letters into the spaced words around them", () => {
    expect(textOf([run("J E F F R E Y", 287, 44), run("M", 337, 8), run("c", 347, 4), run("C L E N D O N ,", 354, 56), run("J O N A T H A N", 417, 60), run("B.", 483, 9), run("L E V I N E", 498, 37)])).toBe("JEFFREY McCLENDON, JONATHAN B. LEVINE");
  });
});
