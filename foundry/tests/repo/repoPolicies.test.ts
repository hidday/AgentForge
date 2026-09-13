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
  it("is valid with no violations when every file matches an allowed path and none are protected", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "src/bar/baz.ts"],
      ["src/"],
      [".github/"],
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats every file as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file that does not start with any allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file that is in a protected path even when it is also allowed", () => {
    const result = validateFilePaths(
      [".github/workflows/ci.yml"],
      [".github/"],
      [".github/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File ".github/workflows/ci.yml" is in a protected path',
    ]);
  });

  it("produces both violations for a file that is neither allowed nor protected-excluded", () => {
    const result = validateFilePaths(
      ["secrets/keys.env"],
      ["src/"],
      ["secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "secrets/keys.env" is not in any allowed path',
      'File "secrets/keys.env" is in a protected path',
    ]);
  });

  it("returns valid for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], [".github/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged count is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary (count === max)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid when filesChanged count exceeds the max", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log", "TODO"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a match when content contains a forbidden literal pattern", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("reports every forbidden pattern that matches, preserving input order", () => {
    const result = checkForbiddenPatterns(
      "eval(userInput); // TODO: remove",
      ["eval\\(", "TODO", "not-present-pattern"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "TODO"]);
  });

  it("treats each pattern as a regular expression", () => {
    const result = checkForbiddenPatterns("password123", ["pass\\w+\\d+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["pass\\w+\\d+"]);
  });

  it("returns valid when forbiddenPatterns is empty", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
