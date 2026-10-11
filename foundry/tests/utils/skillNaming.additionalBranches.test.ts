import { describe, it, expect } from "vitest";
import { normalizeSkillName, slugifySkillName } from "../../src/utils/skillNaming.js";

describe("slugifySkillName — empty-slug fallback branch", () => {
  it("falls back to 'distilled-skill' when the input has no sluggable characters", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("")).toBe("distilled-skill");
    expect(slugifySkillName("---")).toBe("distilled-skill");
  });
});

describe("normalizeSkillName — undefined name branch", () => {
  it("slugifies the fallback when name is undefined (short-circuits before validity check)", () => {
    expect(normalizeSkillName(undefined, "My New Skill")).toBe("my-new-skill");
  });

  it("slugifies the fallback when name is an empty/whitespace-only string", () => {
    expect(normalizeSkillName("   ", "Another Skill")).toBe("another-skill");
  });
});
