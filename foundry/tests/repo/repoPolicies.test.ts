import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and no protected path", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], [".github/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags files outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags files inside a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("can report both an allowed-path and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secret/file.ts"], ["src/"], ["secret/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
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

  it("is valid when within the file-count limit", () => {
    expect(validateDiffSize(["a.ts", "b.ts"], constraints)).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("flags exceeding the max files changed", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every forbidden pattern found in the content", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.env.SECRET",
      ["eval\\(", "process\\.env\\.SECRET"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env\\.SECRET"]);
  });

  it("only reports each pattern once even with multiple occurrences", () => {
    const result = checkForbiddenPatterns("eval(a); eval(b);", ["eval\\("]);
    expect(result.matches).toEqual(["eval\\("]);
  });
});
