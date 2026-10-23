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
  it("allows every file when allowedPaths is empty", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside the allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "other/file.ts" is not in any allowed path`]);
  });

  it("allows a file inside one of several allowed paths", () => {
    const result = validateFilePaths(["lib/file.ts"], ["src/", "lib/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file that is in a protected path even if it's also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "src/secrets.ts" is in a protected path`]);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["other/secrets.ts"], ["src/"], ["other/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain(`File "other/secrets.ts" is not in any allowed path`);
    expect(result.violations).toContain(`File "other/secrets.ts" is in a protected path`);
  });

  it("returns valid=true with no violations for an empty filesChanged array", () => {
    const result = validateFilePaths([], ["src/"], ["secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("accumulates violations across multiple files", () => {
    const result = validateFilePaths(
      ["other/a.ts", "other/b.ts", "src/good.ts"],
      ["src/"],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged count is exactly at the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when filesChanged count exceeds the max by one", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid for zero files changed", () => {
    const result = validateDiffSize([], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("returns valid=true and no matches when content matches no patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a pattern that matches the content", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("flags multiple distinct forbidden patterns that each match", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid=true for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("matches using regex semantics, not plain substring", () => {
    const result = checkForbiddenPatterns("foobar123", ["foo.*123"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["foo.*123"]);
  });
});
