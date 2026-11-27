import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when all files are within allowed paths and none are protected", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats every path as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "other/file.ts" is not in any allowed path`]);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "src/secrets/key.ts" is in a protected path`]);
  });

  it("can report both an unallowed and a protected violation for different files", () => {
    const result = validateFilePaths(
      ["other/file.ts", "src/secrets/key.ts"],
      ["src/"],
      ["src/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("returns no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["src/secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the max files changed (boundary)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when the number of changed files exceeds the max", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log", "debugger"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("console.log('hi')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("flags multiple matching forbidden patterns", () => {
    const result = checkForbiddenPatterns("console.log('hi'); debugger;", [
      "console\\.log",
      "debugger",
      "TODO",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "debugger"]);
  });

  it("returns valid for an empty pattern list", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
