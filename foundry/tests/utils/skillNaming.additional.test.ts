import { describe, it, expect } from "vitest";
import { slugifySkillName } from "../../src/utils/skillNaming.js";

describe("slugifySkillName fallback branch", () => {
  it("falls back to 'distilled-skill' when the input has no valid slug characters", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("   ")).toBe("distilled-skill");
    expect(slugifySkillName("")).toBe("distilled-skill");
  });

  it("truncates overly long slugs to 64 characters", () => {
    const longLabel = "a".repeat(100);
    const slug = slugifySkillName(longLabel);
    expect(slug.length).toBeLessThanOrEqual(64);
  });
});
