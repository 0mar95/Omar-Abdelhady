import { describe, expect, it } from "vitest";
import { splitCodes } from "./Title";

describe("splitCodes", () => {
  it("separates classification codes from the section name", () => {
    expect(splitCodes("Migraine (ICHD 1.x.x; ICD-10 G43.xxx; ICD-11 8A80.xxx)")).toEqual({ name: "Migraine", codes: "ICHD 1.x.x · ICD-10 G43.xxx · ICD-11 8A80.xxx" });
    expect(splitCodes("Central Neuropathic Pain (ICHD 13.13)").name).toBe("Central Neuropathic Pain");
  });
  it("leaves ordinary brackets alone", () => {
    expect(splitCodes("Trigeminal Autonomic Cephalalgias (TACs)")).toEqual({ name: "Trigeminal Autonomic Cephalalgias (TACs)", codes: "" });
    expect(splitCodes("Equivalent (Radiation-Weighted) Dose").codes).toBe("");
  });
});
