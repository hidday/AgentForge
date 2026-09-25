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
  it("returns valid=true with no violations when every file is under an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar/baz.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats every file as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["anything/anywhere.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("reports a violation for a file not under any allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("reports a violation for a file under a protected path", () => {
    const result = validateFilePaths(["prisma/migrations/x.sql"], ["prisma/"], [
      "prisma/migrations/",
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "prisma/migrations/x.sql" is in a protected path']);
  });

  it("reports both violations when a file is neither allowed nor protected-exempt", () => {
    // Not under any allowed path AND under a protected path.
    const result = validateFilePaths(["infra/main.tf"], ["src/"], ["infra/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "infra/main.tf" is not in any allowed path',
      'File "infra/main.tf" is in a protected path',
    ]);
  });

  it("aggregates violations across multiple files", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "docs/readme.md", ".github/workflows/ci.yml"],
      ["src/"],
      [".github/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "docs/readme.md" is not in any allowed path',
      'File ".github/workflows/ci.yml" is not in any allowed path',
      'File ".github/workflows/ci.yml" is in a protected path',
    ]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary (equal to maxFilesChanged)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("reports a violation with the exact message when filesChanged exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid with no matches when content matches none of the patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["TODO", "FIXME"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports the matching pattern when content contains it", () => {
    const result = checkForbiddenPatterns("// TODO: fix this later", ["TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO"]);
  });

  it("reports every pattern that matches, preserving input order", () => {
    const result = checkForbiddenPatterns(
      "console.log('debug'); // FIXME later",
      ["console\\.log", "FIXME", "not-present"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "FIXME"]);
  });

  it("supports regex patterns, not just literal substrings", () => {
    const result = checkForbiddenPatterns("api_key = 'sk-1234567890'", ["sk-[0-9]+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["sk-[0-9]+"]);
  });

  it("returns valid=true when forbiddenPatterns is empty", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
