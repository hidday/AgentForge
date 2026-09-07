import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when all files are within allowed paths and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it's within an allowed path", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("can report both violations for the same file", () => {
    const result = validateFilePaths(["other/secrets/key.ts"], ["src/"], ["other/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('File "other/secrets/key.ts" is not in any allowed path');
    expect(result.violations).toContain('File "other/secrets/key.ts" is in a protected path');
  });

  it("returns valid with no violations for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], ["src/secrets/"])).toEqual({
      valid: true,
      violations: [],
    });
  });
});

describe("validateDiffSize", () => {
  const constraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 3,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when the file count is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], constraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid when the file count equals the max exactly", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result.valid).toBe(true);
  });

  it("is invalid when the file count exceeds the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden patterns match", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a match when a forbidden pattern is found", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports multiple matches when several patterns are found", () => {
    const content = "eval(x); process.exit(1);";
    const result = checkForbiddenPatterns(content, ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("is valid (vacuously) when there are no forbidden patterns to check", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
