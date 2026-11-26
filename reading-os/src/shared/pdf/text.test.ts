import { describe, expect, it } from "vitest";
import { CAPTION_RE, joinLines, normalizeText, parseCitation, WordBook, XREF_RE, xrefKey } from "./text.ts";

describe("normalizeText", () => {
  it("expands ligatures and drops soft hyphens", () => {
    expect(normalizeText("classiﬁcation ﬂow eﬀect")).toBe("classification flow effect");
    expect(normalizeText("hy­phen")).toBe("hyphen");
  });
});

describe("joinLines", () => {
  const book = new WordBook();
  book.addText("classification peer reviewed nociception understanding evidence based");
  book.addHyphenated("an evidence-based approach");

  it("removes the hyphen of a word split across lines", () => {
    expect(joinLines("pain classifi-", "cations are", book)).toBe("pain classifications are");
    expect(joinLines("under-", "standing", book)).toBe("understanding");
  });
  it("keeps real compound hyphens", () => {
    expect(joinLines("an evidence-", "based approach", book)).toBe("an evidence-based approach");
    expect(joinLines("in peer-", "reviewed journals", book)).toBe("in peer-reviewed journals");
    expect(joinLines("the ICD-", "10 codes", book)).toBe("the ICD-10 codes");
  });
  it("adds a space between ordinary lines", () => {
    expect(joinLines("the pain", "persists", book)).toBe("the pain persists");
  });
});

describe("parseCitation", () => {
  it("expands ranges and lists", () => {
    expect(parseCitation("21-23")).toEqual([21, 22, 23]);
    expect(parseCitation("4,5")).toEqual([4, 5]);
    expect(parseCitation("8,17")).toEqual([8, 17]);
    expect(parseCitation("76–80")).toEqual([76, 77, 78, 79, 80]);
  });
  it("rejects non-citations", () => {
    expect(parseCitation("rd")).toBeNull();
    expect(parseCitation("1B/1D")).toBeNull();
  });
});

describe("xrefKey", () => {
  it("normalizes figure, table and box references", () => {
    expect(xrefKey("Figure", "3.2")).toBe("Fig 3-2");
    expect(xrefKey("Fig", "1- 2")).toBe("Fig 1-2");
    expect(xrefKey("Tables", "2–4")).toBe("Table 2-4");
    expect(xrefKey("Box", "5-3")).toBe("Box 5-3");
  });
});

describe("XREF_RE", () => {
  const refs = (s: string) => [...s.matchAll(XREF_RE)].map((m) => [m[0], m[2], m[3] ?? ""]);
  it("takes the whole reference, panel letters included", () => {
    expect(refs("Facial (Fig. 1.32A–C): full smile")).toEqual([["Fig. 1.32A–C", "1.32", "A–C"]]);
    expect(refs("Retracted frontal (Fig. 1.37A-B)")).toEqual([["Fig. 1.37A-B", "1.37", "A-B"]]);
    expect(refs("see Fig 5a and Figure 3-2.")).toEqual([
      ["Fig 5a", "5", "a"],
      ["Figure 3-2", "3-2", ""],
    ]);
    expect(refs("Table 2 lists")).toEqual([["Table 2", "2", ""]]);
    expect(refs("Fig 1.19B) further")).toEqual([["Fig 1.19B", "1.19", "B"]]);
  });
});

describe("CAPTION_RE", () => {
  it("numbers a figure without its capital panel letters", () => {
    expect(CAPTION_RE.exec("Fig. 1.32A Full smile")?.[2]).toBe("1.32");
    expect(CAPTION_RE.exec("Fig 2.4A–C Views")?.[2]).toBe("2.4");
    expect(CAPTION_RE.exec("Fig 5a Detail")?.[2]).toBe("5a");
    expect(CAPTION_RE.exec("Figure 1-1 Collimation")?.[2]).toBe("1-1");
  });
});

describe("symbol-font bullets", () => {
  it("reads private-use bullet characters as bullets", () => {
    expect(normalizeText(" 1–5 years")).toBe("• 1–5 years");
    expect(normalizeText(" Demographic data")).toBe("• Demographic data");
  });
});

describe("unmapped bullet glyphs", () => {
  it("reads a lone control code as a bullet", () => {
    expect(normalizeText("\u0002 Demographic data")).toBe("• Demographic data");
    expect(normalizeText("\u0002")).toBe("•");
    expect(normalizeText("text\u0003")).toBe("text");
  });
});
