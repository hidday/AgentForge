import { describe, it, expect } from "vitest";
import { slugifySkillName, normalizeSkillName } from "../../src/utils/skillNaming.js";

// Targets the `slug || "distilled-skill"` fallback in slugifySkillName(),
// which is only reached when the input reduces to an empty string after
// lowercasing, replacing non [a-z0-9] runs with "-", and trimming leading/
// trailing dashes.
describe("slugifySkillName — empty-slug fallback", () => {
  it("falls back to 'distilled-skill' when the input has no alphanumeric characters", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
  });

  it("falls back to 'distilled-skill' for an empty string input", () => {
    expect(slugifySkillName("")).toBe("distilled-skill");
  });

  it("does not fall back when at least one alphanumeric character survives", () => {
    expect(slugifySkillName("a!!!")).toBe("a");
  });
});

describe("normalizeSkillName — fallback through the empty-slug path", () => {
  it("slugifies to 'distilled-skill' when both name and fallback are non-alphanumeric", () => {
    expect(normalizeSkillName("###", "***")).toBe("distilled-skill");
  });

  it("slugifies the fallback (not 'distilled-skill') when the fallback has real content and name is absent", () => {
    expect(normalizeSkillName(undefined, "Real Fallback Title")).toBe("real-fallback-title");
  });
});
