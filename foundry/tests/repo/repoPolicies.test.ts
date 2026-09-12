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
    maxFilesChanged: 3,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("treats every file as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["anything/here.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("accepts a file inside an allowed path prefix", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("accumulates multiple violations for multiple offending files", () => {
    const result = validateFilePaths(
      ["docs/readme.md", "src/protected.ts"],
      ["src/"],
      ["src/protected.ts"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("returns valid=true with no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is under the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 3 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid at exactly the boundary (equal to the limit)", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], makeConstraints({ maxFilesChanged: 3 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid one file over the limit", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts", "d.ts"],
      makeConstraints({ maxFilesChanged: 3 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden patterns match", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("flags a match when a forbidden pattern is present", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("collects all matching patterns, not just the first", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid=true with no matches for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
