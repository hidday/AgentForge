import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: [],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when all files are within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as 'allow everything'", () => {
    const result = validateFilePaths(["anything/foo.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "docs/readme.md" is not in any allowed path`]);
  });

  it("flags a file inside a protected path even if it's also in an allowed path", () => {
    const result = validateFilePaths(["src/.github/workflows/ci.yml"], ["src/"], [
      "src/.github/",
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      `File "src/.github/workflows/ci.yml" is in a protected path`,
    );
  });

  it("can report both violations for the same file (not allowed AND protected)", () => {
    const result = validateFilePaths(["infra/secrets.yml"], ["src/"], ["infra/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain(`File "infra/secrets.yml" is not in any allowed path`);
    expect(result.violations).toContain(`File "infra/secrets.yml" is in a protected path`);
  });

  it("returns valid for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["infra/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("checks every file and collects violations across multiple files", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "docs/bad.md", "prisma/migrations/x.sql"],
      ["src/"],
      ["prisma/migrations/"],
    );
    expect(result.valid).toBe(false);
    // docs/bad.md (not allowed) + prisma/migrations/x.sql (not allowed AND protected)
    expect(result.violations).toHaveLength(3);
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged count is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the maxFilesChanged boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when filesChanged exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("collects multiple matching patterns", () => {
    const content = "console.log('debug'); eval(x);";
    const result = checkForbiddenPatterns(content, ["console\\.log", "eval\\(", "TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "eval\\("]);
  });

  it("returns valid for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("treats each pattern as a regular expression", () => {
    const result = checkForbiddenPatterns("password123", ["password\\d+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["password\\d+"]);
  });
});
