import { describe, it, expect } from "vitest";
import {
  isValidSkillName,
  normalizeSkillName,
  slugifySkillName,
} from "../../src/utils/skillNaming.js";

describe("slugifySkillName edge cases", () => {
  it("falls back to 'distilled-skill' when nothing alphanumeric remains", () => {
    expect(slugifySkillName("")).toBe("distilled-skill");
    expect(slugifySkillName("!!! / ---")).toBe("distilled-skill");
  });

  it("strips leading/trailing separators and collapses runs", () => {
    expect(slugifySkillName("  --Hello,,  World__ ")).toBe("hello-world");
  });

  it("caps the slug at 64 characters", () => {
    expect(slugifySkillName("a".repeat(100))).toBe("a".repeat(64));
  });
});

describe("isValidSkillName edge cases", () => {
  it.each(["-lead", "trail-", "double--dash", "under_score", ""])("rejects %j", (n) => {
    expect(isValidSkillName(n)).toBe(false);
  });
});

describe("normalizeSkillName edge cases", () => {
  it("trims a valid name before accepting it", () => {
    expect(normalizeSkillName("  redis-cache  ", "fallback")).toBe("redis-cache");
  });

  it("uses the slugified fallback when the name is undefined or blank", () => {
    expect(normalizeSkillName(undefined, "Redis Cache")).toBe("redis-cache");
    expect(normalizeSkillName("   ", "Redis Cache")).toBe("redis-cache");
  });

  it("uses 'distilled-skill' when both name and fallback are unusable", () => {
    expect(normalizeSkillName("!!!", "???")).toBe("distilled-skill");
  });
});
