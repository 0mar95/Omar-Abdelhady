import { describe, expect, it } from "vitest";
import { fontFamilyKey, repairPrivateGlyphs } from "./glyphs";
import type { RawPage } from "./load";

const page = (index: number, font: string, lines: string[]): RawPage => ({
  index,
  w: 500,
  h: 700,
  graphics: [],
  runs: lines.map((str, i) => ({ str, x: 40, y: 60 + i * 12, w: 400, size: 10, font, bold: false, italic: false, rotated: false })),
});

describe("repairPrivateGlyphs", () => {
  it("works out ligatures and full stops per font from the book's own words", () => {
    // U+E01A = ff, U+E019 = fi, U+E01B = Th, U+E01D = full stop — as in a real textbook.
    const pages = [
      page(0, "AAAAAB+p22_Body", [
        "Like the eects of exposure, the radiation is us reduced e beam",
        "does not oer any benet A lter is placed in the path The lm",
        "shows the eect of the lament Effects and effect and offer are common",
        "Thus the beam is reduced and the patient gets the benefit of a better film",
      ]),
      page(1, "AAAAAC+p23_Body", ["The dierence in Fig 116 is clear Difference matters"]),
      page(2, "AAAAAD+p24_Graph", [" 0  0"]),
    ];
    expect(repairPrivateGlyphs(pages)).toBeGreaterThanOrEqual(4);
    const text = pages.flatMap((p) => p.runs.map((r) => r.str)).join("\n");
    expect(text).toContain("Like the effects of exposure, the radiation is Thus reduced. The beam");
    expect(text).toContain("does not offer any benefit. A filter is placed in the path. The film");
    expect(text).toContain("The difference in Fig. 1.16 is clear.");
    // Unknown glyphs (axis labels in a figure) are left alone.
    expect(text).toContain(" 0");
  });

  it("does nothing for ordinary text", () => {
    const pages = [page(0, "Body", ["Plain text with no private glyphs."])];
    expect(repairPrivateGlyphs(pages)).toBe(0);
    expect(pages[0].runs[0].str).toBe("Plain text with no private glyphs.");
  });

  it("pools one font embedded once per page", () => {
    expect(fontFamilyKey("ABCDEF+p22_g_d0_f32")).toBe("g_d0_f32");
    expect(fontFamilyKey("p23_g_d0_f32")).toBe("g_d0_f32");
  });
});
