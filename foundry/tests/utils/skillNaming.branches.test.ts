import { describe, it, expect } from "vitest";
import { slugifySkillName } from "../../src/utils/skillNaming.js";

// Covers the fallback branch of slugifySkillName (slug ends up empty after
// stripping/trimming) that skillNaming.test.ts does not exercise.

describe("slugifySkillName fallback branch", () => {
  it("falls back to 'distilled-skill' when the input has no alphanumeric characters", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("   ")).toBe("distilled-skill");
    expect(slugifySkillName("---")).toBe("distilled-skill");
  });
});
