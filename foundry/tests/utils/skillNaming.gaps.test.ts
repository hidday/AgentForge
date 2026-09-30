import { describe, it, expect } from "vitest";
import { slugifySkillName, isValidSkillName, normalizeSkillName } from "../../src/utils/skillNaming.js";

describe("slugifySkillName -- boundary conditions (gap coverage)", () => {
  it("falls back to 'distilled-skill' when the input has no alphanumeric characters", () => {
    expect(slugifySkillName("!!!???")).toBe("distilled-skill");
  });

  it("falls back to 'distilled-skill' for an empty string", () => {
    expect(slugifySkillName("")).toBe("distilled-skill");
  });

  it("truncates slugs longer than 64 characters", () => {
    const longInput = "a".repeat(100);
    const slug = slugifySkillName(longInput);
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it("strips leading and trailing hyphens produced by punctuation", () => {
    expect(slugifySkillName("--hello world--")).toBe("hello-world");
  });
});

describe("isValidSkillName", () => {
  it("rejects names with uppercase letters", () => {
    expect(isValidSkillName("Retry-Backoff")).toBe(false);
  });

  it("rejects names with leading/trailing hyphens", () => {
    expect(isValidSkillName("-retry-backoff")).toBe(false);
    expect(isValidSkillName("retry-backoff-")).toBe(false);
  });

  it("rejects names with consecutive hyphens or underscores", () => {
    expect(isValidSkillName("retry--backoff")).toBe(false);
  });

  it("accepts a single-word kebab-case name", () => {
    expect(isValidSkillName("retry")).toBe(true);
  });
});

describe("normalizeSkillName -- fallback branch (gap coverage)", () => {
  it("uses the fallback slugified name when name is undefined", () => {
    expect(normalizeSkillName(undefined, "My New Skill")).toBe("my-new-skill");
  });

  it("uses the fallback slugified name when name is only whitespace", () => {
    expect(normalizeSkillName("   ", "Whitespace Fallback")).toBe("whitespace-fallback");
  });

  it("uses the fallback when the provided name is not valid kebab-case", () => {
    expect(normalizeSkillName("Not Valid!", "fallback-name")).toBe("fallback-name");
  });

  it("trims a valid name with surrounding whitespace and keeps it", () => {
    expect(normalizeSkillName("  valid-name  ", "ignored")).toBe("valid-name");
  });
});
