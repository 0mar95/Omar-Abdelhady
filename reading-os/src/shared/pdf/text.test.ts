import { describe, expect, it } from "vitest";
import { joinLines, normalizeText, parseCitation, WordBook, xrefKey } from "./text.ts";

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
