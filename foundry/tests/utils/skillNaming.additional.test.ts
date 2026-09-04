import { describe, it, expect } from "vitest";
import { slugifySkillName } from "../../src/utils/skillNaming.js";

describe("skillNaming - slugifySkillName fallback", () => {
  it("falls back to 'distilled-skill' when the input has no valid slug characters", () => {
    // Every character is stripped by the [^a-z0-9]+ replacement, leaving an
    // empty slug -- exercises the `slug || "distilled-skill"` fallback branch.
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("   ")).toBe("distilled-skill");
    expect(slugifySkillName("")).toBe("distilled-skill");
  });
});
