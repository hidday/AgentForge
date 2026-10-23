import { describe, it, expect } from "vitest";
import { slugifySkillName } from "../../src/utils/skillNaming.js";

// Covers slugifySkillName()'s fallback branch (`return slug || "distilled-skill"`)
// when the input has no alphanumeric characters at all, so stripping
// non-alphanumerics and trimming dashes leaves an empty string.

describe("slugifySkillName — empty-slug fallback", () => {
  it("falls back to 'distilled-skill' when the input has no alphanumeric characters", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("   ")).toBe("distilled-skill");
    expect(slugifySkillName("---")).toBe("distilled-skill");
  });
});
