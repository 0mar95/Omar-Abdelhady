import { describe, expect, it } from "vitest";
import { parseContentsEntry } from "./blocks";

describe("parseContentsEntry", () => {
  it("reads numbered chapters with spacer glyphs or dot leaders", () => {
    expect(parseContentsEntry("1 Introduction to Orofacial Pain!!1")).toEqual({ num: "1", title: "Introduction to Orofacial Pain", page: "1" });
    expect(parseContentsEntry("12 Axis II: Biobehavioral Considerations . . . . . 316")).toEqual({
      num: "12",
      title: "Axis II: Biobehavioral Considerations",
      page: "316",
    });
    expect(parseContentsEntry("3. Pain Classification ........ 62")).toEqual({ num: "3", title: "Pain Classification", page: "62" });
  });

  it("reads front matter with roman page numbers", () => {
    expect(parseContentsEntry("Preface vi")).toEqual({ num: undefined, title: "Preface", page: "vi" });
    expect(parseContentsEntry("Index 342")).toEqual({ num: undefined, title: "Index", page: "342" });
  });

  it("leaves prose alone", () => {
    expect(parseContentsEntry("and can be accessed by scanning")).toBeNull();
    expect(parseContentsEntry("this QR code.")).toBeNull();
    expect(parseContentsEntry("studies published in 2013")).toBeNull();
    expect(parseContentsEntry("2022")).toBeNull();
  });
});
