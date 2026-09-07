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

  it("slugifySkillName falls back to 'distilled-skill' when the input has no alphanumeric characters", () => {
    expect(slugifySkillName("!!!")).toBe("distilled-skill");
    expect(slugifySkillName("")).toBe("distilled-skill");
  });

  it("normalizeSkillName falls back through slugifySkillName when name is undefined", () => {
    expect(normalizeSkillName(undefined, "Auth Middleware")).toBe("auth-middleware");
  });

  it("normalizeSkillName treats a whitespace-only name as absent", () => {
    expect(normalizeSkillName("   ", "Auth Middleware")).toBe("auth-middleware");
  });
});
