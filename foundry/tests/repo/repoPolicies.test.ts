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
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "src/bar/baz.ts"],
      ["src/"],
      ["src/protected/"],
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats every file as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["anything/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file under a protected path even if it is also allowed", () => {
    const result = validateFilePaths(
      ["src/protected/secret.ts"],
      ["src/"],
      ["src/protected/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/protected/secret.ts" is in a protected path']);
  });

  it("reports both violations for a file that is unallowed and protected", () => {
    const result = validateFilePaths(["secret/x.ts"], ["src/"], ["secret/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual([
      'File "secret/x.ts" is not in any allowed path',
      'File "secret/x.ts" is in a protected path',
    ]);
  });

  it("accumulates violations across multiple files", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "other/bad.ts", "src/protected/nope.ts"],
      ["src/"],
      ["src/protected/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("returns valid for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["src/protected/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged count is at the max boundary", () => {
    const result = validateDiffSize(
      Array.from({ length: 10 }, (_, i) => `file${String(i)}.ts`),
      makeConstraints({ maxFilesChanged: 10 }),
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when filesChanged exceeds the max by one", () => {
    const result = validateDiffSize(
      Array.from({ length: 11 }, (_, i) => `file${String(i)}.ts`),
      makeConstraints({ maxFilesChanged: 10 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 11 files (max: 10)"]);
  });

  it("is valid for an empty file list", () => {
    const result = validateDiffSize([], makeConstraints({ maxFilesChanged: 1 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "TODO"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a single matching pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every pattern that matches, in order", () => {
    const result = checkForbiddenPatterns("eval(x); // TODO fix", ["eval\\(", "TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "TODO"]);
  });

  it("returns valid with no matches when there are no patterns to check", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
