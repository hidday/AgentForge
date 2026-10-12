import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("allows every file when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/foo.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/foo.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("accepts a file that is allowed and not protected", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("collects violations across multiple files", () => {
    const result = validateFilePaths(
      ["other/foo.ts", "src/secrets.ts"],
      ["src/"],
      ["src/secrets.ts"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  const baseConstraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 2,
    maxDiffLines: 100,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when files changed is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], baseConstraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags when files changed exceeds the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], baseConstraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags content that matches a forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });
});
