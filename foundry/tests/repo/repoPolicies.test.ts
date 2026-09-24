import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 3,
    maxDiffLines: 200,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("allows all files when allowedPaths is empty and none are protected", () => {
    const result = validateFilePaths(["src/a.ts", "docs/readme.md"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/a.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/a.ts" is not in any allowed path']);
  });

  it("passes a file that matches an allowed path prefix", () => {
    const result = validateFilePaths(["src/a.ts"], ["src/", "tests/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file under a protected path even if it is otherwise allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("can report both an allowed-path and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["infra/deploy.yml"], ["src/"], ["infra/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "infra/deploy.yml" is not in any allowed path',
      'File "infra/deploy.yml" is in a protected path',
    ]);
  });

  it("aggregates violations across multiple files", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "other/bad.ts", ".github/workflows/ci.yml"],
      ["src/"],
      [".github/"],
    );
    expect(result.valid).toBe(false);
    // "other/bad.ts" is not allowed; ".github/workflows/ci.yml" is both
    // not allowed and protected, contributing two violations on its own.
    expect(result.violations).toHaveLength(3);
  });
});

describe("validateDiffSize", () => {
  it("is valid when files changed equals the max (boundary, not exceeded)", () => {
    const result = validateDiffSize(["a", "b", "c"], makeConstraints({ maxFilesChanged: 3 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when files changed exceeds the max by one", () => {
    const result = validateDiffSize(
      ["a", "b", "c", "d"],
      makeConstraints({ maxFilesChanged: 3 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });

  it("is valid for an empty file list", () => {
    const result = validateDiffSize([], makeConstraints({ maxFilesChanged: 1 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("reports no matches when content has none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log", "debugger"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a single matching pattern", () => {
    const result = checkForbiddenPatterns("console.log('hi')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("reports multiple matching patterns", () => {
    const content = "console.log('x'); debugger;";
    const result = checkForbiddenPatterns(content, ["console\\.log", "debugger", "TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "debugger"]);
  });

  it("is valid when the pattern list is empty", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
