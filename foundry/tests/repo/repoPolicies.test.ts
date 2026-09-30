import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("allows every file when allowedPaths is empty", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("can report both an out-of-allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["danger/secrets.ts"], ["src/"], ["danger/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "danger/secrets.ts" is not in any allowed path',
      'File "danger/secrets.ts" is in a protected path',
    ]);
  });

  it("passes a file that is both allowed and not protected", () => {
    const result = validateFilePaths(["src/index.ts"], ["src/"], ["src/generated/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("passes an empty file list", () => {
    expect(validateFilePaths([], ["src/"], [])).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  const constraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 2,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("passes when the number of changed files is within the limit", () => {
    expect(validateDiffSize(["a.ts", "b.ts"], constraints)).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("flags when the number of changed files exceeds the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("passes an empty file list", () => {
    expect(validateDiffSize([], constraints)).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("passes content with no forbidden patterns", () => {
    expect(checkForbiddenPatterns("const x = 1;", ["eval\\("])).toEqual({
      valid: true,
      matches: [],
    });
  });

  it("flags content matching a forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("collects every forbidden pattern that matches, not just the first", () => {
    const result = checkForbiddenPatterns(
      "eval('x'); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("passes when forbiddenPatterns is empty", () => {
    expect(checkForbiddenPatterns("anything at all", [])).toEqual({
      valid: true,
      matches: [],
    });
  });
});
