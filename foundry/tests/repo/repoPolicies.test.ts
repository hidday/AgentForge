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
    maxFilesChanged: 5,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when all files are under an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allow-everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file under a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.env"], ["src/"], ["src/secrets.env"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.env" is in a protected path']);
  });

  it("can report both violations for the same file", () => {
    const result = validateFilePaths(["other/secrets.env"], ["src/"], ["other/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "other/secrets.env" is not in any allowed path',
      'File "other/secrets.env" is in a protected path',
    ]);
  });

  it("returns no violations for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], ["secrets/"])).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a diff that exceeds the file count limit", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no pattern matches the content", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "debugger"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every pattern that matches", () => {
    const result = checkForbiddenPatterns("eval('x'); debugger;", ["eval\\(", "debugger"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "debugger"]);
  });

  it("reports only the patterns that match out of several", () => {
    const result = checkForbiddenPatterns("console.log('debugger-like text')", [
      "eval\\(",
      "debugger",
    ]);
    expect(result.matches).toEqual(["debugger"]);
  });

  it("returns valid for an empty pattern list", () => {
    expect(checkForbiddenPatterns("anything", [])).toEqual({ valid: true, matches: [] });
  });
});
