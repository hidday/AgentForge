import { describe, it, expect } from "vitest";
import { slugifySkillName, normalizeSkillName } from "../../src/utils/skillNaming.js";

describe("skillNaming (gaps)", () => {
  it("slugifySkillName falls back to 'distilled-skill' when the input slugifies to empty", () => {
    expect(slugifySkillName("")).toBe("distilled-skill");
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("---")).toBe("distilled-skill");
  });

  it("normalizeSkillName falls back to slugified fallback when name is undefined", () => {
    expect(normalizeSkillName(undefined, "My Fallback Label")).toBe("my-fallback-label");
  });

  it("normalizeSkillName falls back when the trimmed name is empty", () => {
    expect(normalizeSkillName("   ", "fallback label")).toBe("fallback-label");
  });
});
