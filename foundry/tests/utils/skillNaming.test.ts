import { describe, it, expect } from "vitest";
import { isValidSkillName, normalizeSkillName, slugifySkillName } from "../../src/utils/skillNaming.js";

describe("skillNaming", () => {
  it("slugifySkillName converts labels to kebab-case", () => {
    expect(slugifySkillName("dev-env pause/resume tooling")).toBe(
      "dev-env-pause-resume-tooling",
    );
  });

  it("isValidSkillName accepts kebab-case slugs", () => {
    expect(isValidSkillName("dev-env-pause-resume-footguns")).toBe(true);
    expect(isValidSkillName("Dev Env")).toBe(false);
  });

  it("normalizeSkillName keeps valid names and slugifies fallback", () => {
    expect(normalizeSkillName("dev-env-pause-resume-footguns", "ignored")).toBe(
      "dev-env-pause-resume-footguns",
    );
    expect(normalizeSkillName("Bad Name!", "dev-env pause/resume")).toBe(
      "dev-env-pause-resume",
    );
  });

  it("normalizeSkillName falls back to the slugified fallback when name is undefined", () => {
    expect(normalizeSkillName(undefined, "some fallback label")).toBe("some-fallback-label");
  });

  it("normalizeSkillName falls back when name is only whitespace", () => {
    expect(normalizeSkillName("   ", "some fallback label")).toBe("some-fallback-label");
  });
});
