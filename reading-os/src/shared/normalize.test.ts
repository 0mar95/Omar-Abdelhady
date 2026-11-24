import { describe, expect, it } from "vitest";
import type { Block, HeadingBlock, ParagraphBlock } from "./model.ts";
import { normalizeStructure, placeFigures, tidyHeading } from "./normalize.ts";

const R = { x0: 0, y0: 0, x1: 0, y1: 0 };
let n = 0;
const h = (text: string, level: 1 | 2 | 3 | 4 = 1, page = 0): HeadingBlock => ({ kind: "heading", id: `b${n++}`, page, rect: R, chapter: 0, level, text });
const p = (text: string, page = 0): ParagraphBlock => ({ kind: "paragraph", id: `b${n++}`, page, rect: R, chapter: 0, spans: [{ text }] });
const textOf = (b: Block) => (b.kind === "paragraph" ? b.spans.map((s) => s.text).join("") : b.kind === "heading" ? b.text : "");

describe("tidyHeading", () => {
  it("turns ALL CAPS into title case and keeps roman numerals", () => {
    expect(tidyHeading("THE HYPOTHALAMUS AND PAIN")).toBe("The Hypothalamus and Pain");
    expect(tidyHeading("CHAPTER IV")).toBe("Chapter IV");
  });
  it("drops dot leaders and page numbers", () => {
    expect(tidyHeading("Introduction ........ 12")).toBe("Introduction");
  });
});

describe("normalizeStructure", () => {
  it("merges a 'Chapter N' label with the title after it", () => {
    const out = normalizeStructure([h("Chapter 3"), h("Distributions"), p("Text.")]) as Block[];
    expect(out[0]).toMatchObject({ kind: "heading", number: "3", text: "Distributions" });
    expect(out).toHaveLength(2);
  });

  it("numbers '3. Title' chapter headings", () => {
    const [first] = normalizeStructure([h("3. Muscle Pain")]);
    expect(first).toMatchObject({ number: "3", text: "Muscle Pain" });
  });

  it("joins a sentence broken across a figure", () => {
    const fig: Block = { kind: "figure", id: "f", page: 0, rect: R, chapter: 0, caption: [] } as unknown as Block;
    const out = normalizeStructure([p("The beam passes through"), fig, p("the patient and strikes the sensor.")]);
    expect(out.map(textOf)[0]).toBe("The beam passes through the patient and strikes the sensor.");
  });

  it("removes a line-break hyphen when joining", () => {
    const out = normalizeStructure([p("an increase in temper-"), p("ature follows.")]);
    expect(textOf(out[0])).toBe("an increase in temperature follows.");
  });

  it("keeps glossary entries apart", () => {
    const out = normalizeStructure([p("interpreter: A program that reads another program and executes it"), p("prompt: Characters displayed by the interpreter.")]);
    expect(out).toHaveLength(2);
  });

  it("never lets heading levels skip", () => {
    const out = normalizeStructure([h("One", 1), h("Deep", 4), h("Deeper", 4)]).filter((b): b is HeadingBlock => b.kind === "heading");
    expect(out.map((b) => b.level)).toEqual([1, 2, 2]);
  });

  it("promotes second-level headings to chapters in a long book with no chapters", () => {
    const body = p("word ".repeat(16000));
    const out = normalizeStructure([h("Title", 1), h("A", 2), body, h("B", 2), h("C", 2)]).filter((b): b is HeadingBlock => b.kind === "heading");
    expect(out.map((b) => b.level)).toEqual([1, 1, 1, 1]);
  });
});

describe("opening pages", () => {
  const imprintPage = [
    p("This edition first published 2012 © 2012 by Blackwell Publishing Ltd", 5),
    p("All rights reserved. No part of this publication may be reproduced.", 5),
    p("Library of Congress Cataloging-in-Publication Data", 5),
    { kind: "list", id: "l", page: 5, rect: R, chapter: 0, items: [[{ text: "; cm." }]] } as Block,
    p("ISBN 978-0-470-67396-6 (pbk. : alk. paper)", 5),
    p(",", 5),
  ];

  it("folds the copyright page into one publication-details block", () => {
    const out = normalizeStructure([h("Dental Emergencies", 1, 0), ...imprintPage, h("Contents", 1, 7), p("Body.", 7)]);
    const imprint = out.filter((b) => b.kind === "imprint");
    expect(imprint).toHaveLength(1);
    expect(imprint[0].kind === "imprint" && imprint[0].lines.some((l) => l.includes("ISBN"))).toBe(true);
    expect(out.some((b) => textOf(b) === ",")).toBe(false);
  });

  it("composes the title pages: one title, the editors, the edition", () => {
    const out = normalizeStructure([
      h("Dental Emergencies", 1, 0),
      p("edited by", 0),
      h("Mark Greenwood | Ian Corbett", 1, 0),
      h("Dental Emergencies", 1, 2),
      h("Edited by", 3, 4),
      p("Mark Greenwood", 4),
      p("MDS, PhD, FDS, FRCS", 4),
      p("Second Edition", 4),
      p("A John Wiley & Sons, Ltd., Publication", 4),
      ...imprintPage,
      h("Introduction", 1, 8),
    ]);
    const tp = out[0];
    expect(tp).toMatchObject({ kind: "titlepage", title: "Dental Emergencies", byline: "Mark Greenwood · Ian Corbett", edited: true, edition: "Second Edition", publisher: "A John Wiley & Sons, Ltd., Publication" });
    expect(tp.kind === "titlepage" && tp.details).toEqual(["MDS, PhD, FDS, FRCS"]);
    expect(out.filter((b): b is HeadingBlock => b.kind === "heading").map((b) => b.text)).toEqual(["Introduction"]);
  });

  it("leaves a preface before a late contents page alone", () => {
    const out = normalizeStructure([h("Think Python", 1, 0), h("Preface", 1, 4), p("Why I wrote it.", 4), { kind: "contents", id: "c", page: 12, rect: R, chapter: 0, entries: [] } as Block]);
    expect(out.filter((b) => b.kind === "heading")).toHaveLength(2);
  });
});

describe("web addresses", () => {
  const code = (line: string): Block => ({ kind: "code", id: `c${n++}`, page: 0, rect: R, chapter: 0, lines: [line] });
  it("puts an address set on its own line back into its sentence", () => {
    const out = normalizeStructure([p("The third edition is available at"), code("thinkpython.com"), p("Next.")]);
    expect(out).toHaveLength(2);
    expect(textOf(out[0])).toBe("The third edition is available at thinkpython.com");
  });
  it("rejoins an address broken after https:", () => {
    const first = p("License, which is available at ");
    first.spans.push({ text: "https:", code: true });
    const out = normalizeStructure([first, code("//creativecommons.org/licenses/by-nc/3.0/.")]);
    expect(textOf(out[0])).toBe("License, which is available at https://creativecommons.org/licenses/by-nc/3.0/.");
  });
  it("leaves real code alone", () => {
    expect(normalizeStructure([p("Run this:"), code("print(1)")])[1].kind).toBe("code");
  });
});

describe("title pages", () => {
  it("shows lines repeated on the half-title page once, with a subtitle", () => {
    const out = normalizeStructure([p("Think Python", 0), p("How to Think Like a Computer Scientist", 0), p("2nd Edition, Version 2.4.1", 0), p("Think Python", 2), p("2nd Edition, Version 2.4.1", 2), p("Allen Downey", 2), p("Green Tea Press", 2), p("Copyright © 2015 Allen Downey. All rights reserved.", 3), p("Printed in the USA. ISBN 1-2-3", 3)]);
    expect(out[0]).toMatchObject({ kind: "titlepage", title: "Think Python", subtitle: "How to Think Like a Computer Scientist", edition: "2nd Edition, Version 2.4.1", byline: "Allen Downey", publisher: "Green Tea Press", details: [] });
    expect(out[1].kind).toBe("imprint");
  });
});

describe("placeFigures", () => {
  const fig = (key: string, page: number): Block => ({ kind: "figure", id: `f${n++}`, page, rect: R, chapter: 0, key, caption: [] }) as unknown as Block;
  const mention = (key: string, page: number): ParagraphBlock => ({ ...p("See ", page), spans: [{ text: "See " }, { text: key, xref: key }, { text: "." }] });
  it("moves a figure to just after its first mention", () => {
    const f = fig("Fig 1-1", 2);
    const out = placeFigures([f, p("Intro.", 2), mention("Fig 1-1", 3), p("More.", 3)]);
    expect(out.map((b) => b.kind)).toEqual(["paragraph", "paragraph", "figure", "paragraph"]);
  });
  it("leaves a far-away figure where it is", () => {
    const out = placeFigures([fig("Fig 1-1", 2), mention("Fig 1-1", 9)]);
    expect(out[0].kind).toBe("figure");
  });
  it("does not move a figure into another chapter", () => {
    const out = placeFigures([fig("Fig 1-1", 2), h("Chapter Two", 1, 3), mention("Fig 1-1", 3)]);
    expect(out[0].kind).toBe("figure");
  });
});

describe("title pages of an edited textbook", () => {
  it("takes the title first, splits off the edition, and lists the editors", () => {
    const out = normalizeStructure([
      p("Orofacial Pain", 1),
      p("Guidelines for Assessment, Diagnosis, and Management, Seventh Edition", 1),
      h("American Academy of Orofacial Pain", 1, 2),
      p("Editors", 2),
      p("Gary D. Klasser, DMD", 2),
      p("Marcela Romero Reyes, DDS, PhD", 2),
      p("Contributors", 2),
      p("Simon Akerman, PhD", 2),
      p("SEVENTH EDITION", 3),
      p("Copyright © 2024 Quintessence Publishing. All rights reserved.", 5),
      p("ISBN 978-1-64724-123-4. Printed in the USA.", 5),
    ]);
    expect(out[0]).toMatchObject({
      kind: "titlepage",
      title: "Orofacial Pain",
      subtitle: "Guidelines for Assessment, Diagnosis, and Management",
      edition: "Seventh Edition",
      edited: true,
      byline: "Gary D. Klasser · Marcela Romero Reyes",
    });
  });
});

describe("recoverContents", () => {
  it("builds a contents page from titles and page numbers on separate lines", () => {
    // The order pdf.js reads Techniques for Success with Implants' contents in.
    const it_ = (t: string, page = 3) => ({ ...p(t, page), spans: [{ text: t, i: true }] });
    const out = normalizeStructure([
      p("Printed in China", 2),
      it_("Foreword vii Preface viii Contributors x"),
      h("Introduction", 2, 3),
      it_("1"),
      h("Contents", 1, 3),
      p("1 / Arndt Happe, Gerd Körner", 3),
      h("Requirements", 2, 3),
      p("2 / Arndt Happe", 3),
      h("Microsurgery", 2, 3),
      it_("17"),
      it_("29"),
      p("3 / Arndt Happe, Gerd Körner", 3),
      h("Immediate Implant Placement in the Esthetic Zone", 2, 3),
      it_("39"),
      p("/ Arndt Happe, Gerd Körner", 3),
      h("Implant Position, Planning, and Esthetic Analysis", 2, 3),
      it_("69"),
      p("/ Arndt Happe, Christian Coachman, Tal Morr,", 3),
      p("Vincent Fehmer, Irena Sailer", 3),
      p("‘Beauty is in the eye of the beholder’, it is said, and we have been hearing this old comment for many years.", 9),
    ]);
    const c = out.find((b) => b.kind === "contents");
    expect(c?.kind === "contents" && c.entries.map((e) => [e.num ?? "", e.title, e.page, e.authors ?? ""])).toEqual([
      ["", "Foreword", "vii", ""],
      ["", "Preface", "viii", ""],
      ["", "Contributors", "x", ""],
      ["1", "Introduction", "1", "Arndt Happe, Gerd Körner"],
      ["2", "Requirements", "17", "Arndt Happe"],
      ["3", "Microsurgery", "29", "Arndt Happe, Gerd Körner"],
      ["4", "Immediate Implant Placement in the Esthetic Zone", "39", "Arndt Happe, Gerd Körner"],
      ["5", "Implant Position, Planning, and Esthetic Analysis", "69", "Arndt Happe, Christian Coachman, Tal Morr, Vincent Fehmer, Irena Sailer"],
    ]);
    expect(out.some((b) => b.kind === "paragraph" && textOf(b).startsWith("‘Beauty"))).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    const out = normalizeStructure([h("Methods", 2, 4), p("We measured 12 teeth.", 4), p("Results were clear.", 4), h("Results", 2, 4), p("3", 4)]);
    expect(out.some((b) => b.kind === "contents")).toBe(false);
  });
});

describe("a title set over several lines", () => {
  it("joins the lines and keeps the volume out of the byline", () => {
    const out = normalizeStructure([
      p("Essentials of", 0),
      p("Esthetic", 0),
      p("Dentistry", 0),
      p("Volume Two", 0),
      p("Edinburgh London New York Oxford Philadelphia St Louis Sydney Toronto", 2),
      p("Copyright © 2014 Elsevier Ltd. All rights reserved.", 3),
      p("ISBN 978-0-7234-3654-1", 3),
    ]);
    expect(out[0]).toMatchObject({ kind: "titlepage", title: "Essentials of Esthetic Dentistry", edition: "Volume Two" });
    expect(out[0].kind === "titlepage" && out[0].byline).toBeUndefined();
    expect(out[0].kind === "titlepage" && out[0].publisher).toBeUndefined();
  });
});

describe("headingOnlyPages", () => {
  it("turns a page of headings with no text into a list", () => {
    const out = normalizeStructure([h("Also in this series", 1, 4), h("Requirements", 1, 4), h("Microsurgery", 1, 4), h("Bone Augmentation", 1, 4), h("Complications", 1, 4), h("Real Chapter", 1, 9), p("Body text here.", 9)]);
    expect(out.filter((b) => b.kind === "heading").map((b) => (b as HeadingBlock).text)).toEqual(["Real Chapter"]);
    expect(out[0].kind).toBe("list");
  });
});

describe("chapter labels with a caption in front", () => {
  it("keeps just the label", () => {
    const [first] = normalizeStructure([h("He rode a black horse. CHAPTER III.", 1), p("Text.")]);
    expect(first).toMatchObject({ kind: "heading", text: "Chapter III" });
  });
});

describe("slash running headers", () => {
  it("drops '1 / Introduction' and '/' + a section name", () => {
    const out = normalizeStructure([h("Introduction", 1, 9), p("Text one.", 9), p("1 / Introduction", 10), p("More text.", 10), p("/", 11), p("Patient-Related Factors", 11), h("Patient-Related Factors", 2, 11), p("Body.", 11)]);
    expect(out.map(textOf)).toEqual(["Introduction", "Text one.", "More text.", "Patient-Related Factors", "Body."]);
  });
});

describe("cleanTitle", () => {
  it("keeps the book's name from a file-name style title", async () => {
    const { cleanTitle } = await import("./normalize.ts");
    expect(cleanTitle("Color Atlas of Oral and Maxillofacial Diseases - Brad W. Neville, Douglas D. Damm, Carl M. Allen, Angela C. Chi - (2019) 546pp. 978-0323552257")).toBe("Color Atlas of Oral and Maxillofacial Diseases");
    expect(cleanTitle("Techniques_for_Success_with_Implants_in_The_Esthetic_Zone.pdf")).toBe("Techniques for Success with Implants in The Esthetic Zone");
    expect(cleanTitle("Think Python")).toBe("Think Python");
    expect(cleanTitle("Color Atlas of Oral and Maxillofacial Diseases ( PDFDrive )")).toBe("Color Atlas of Oral and Maxillofacial Diseases");
    expect(cleanTitle("Color_Atlas_of_Oral_and_Maxillofacial_Diseases__PDFDrive_.pdf")).toBe("Color Atlas of Oral and Maxillofacial Diseases");
    expect(cleanTitle("Orofacial Pain - Guidelines for Assessment")).toBe("Orofacial Pain: Guidelines for Assessment");
  });
});

describe("tidyContents", () => {
  it("drops trailing commas and nests a chapter's section list under it", () => {
    const entries = [
      { num: "1", title: "Developmental Defects,", page: "1" },
      { num: "2", title: "Pathology of Teeth,", page: "41" },
      { num: "3", title: "Pulp and Periapical Disease,", page: "79" },
      { title: "Index,", page: "529" },
      { title: "Cleft Lip and Palate,", page: "2" },
      { title: "Bifid Uvula,", page: "2" },
      { title: "Fordyce Granules,", page: "6" },
      { title: "Attrition,", page: "42" },
    ];
    const out = normalizeStructure([h("Contents", 1, 4), { kind: "contents", id: "c", page: 4, rect: R, chapter: 0, entries } as Block]);
    const c = out.find((b) => b.kind === "contents");
    expect(c?.kind === "contents" && c.entries.map((e) => `${e.sub ? "  " : ""}${e.num ?? ""} ${e.title} ${e.page}`.trim())).toEqual([
      "1 Developmental Defects 1",
      "Cleft Lip and Palate 2",
      "Bifid Uvula 2",
      "Fordyce Granules 6",
      "2 Pathology of Teeth 41",
      "Attrition 42",
      "3 Pulp and Periapical Disease 79",
      "Index 529",
    ].map((x) => x));
  });
});

describe("chaptersFollowContents", () => {
  it("keeps the listed chapters as chapters and makes the rest sections", () => {
    const entries = [1, 2, 3].map((n) => ({ num: String(n), title: ["Developmental Defects", "Pathology of Teeth", "Pulp Disease"][n - 1], page: String(n * 40) }));
    const heads = ["Developmental Defects", "Cleft Lip", "Bifid Uvula", "Varicosities", "Caliber-Persistent Artery", "Pathology of Teeth", "Attrition", "Abrasion", "Pulp Disease", "Pulpitis"].map((t, i) => [h(t, 1, 10 + i), p("Text about it.", 10 + i)]).flat();
    const out = normalizeStructure([{ kind: "contents", id: "c", page: 4, rect: R, chapter: 0, entries } as Block, ...heads]);
    const levels = out.filter((b): b is HeadingBlock => b.kind === "heading").map((b) => `${b.level}${b.number ? `:${b.number}` : ""} ${b.text}`);
    expect(levels).toEqual(["1:1 Developmental Defects", "2 Cleft Lip", "2 Bifid Uvula", "2 Varicosities", "2 Caliber-Persistent Artery", "1:2 Pathology of Teeth", "2 Attrition", "2 Abrasion", "1:3 Pulp Disease", "2 Pulpitis"]);
  });
});
