import { describe, it, expect } from "vitest";
import { slugifySkillName } from "../../src/utils/skillNaming.js";

describe("slugifySkillName fallback", () => {
  it("falls back to 'distilled-skill' when the input slugifies to an empty string", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("   ")).toBe("distilled-skill");
    expect(slugifySkillName("")).toBe("distilled-skill");
  });
});
