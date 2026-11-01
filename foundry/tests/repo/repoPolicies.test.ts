import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("allows every file when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/anything.ts"], [], []);
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

  it("accumulates multiple violations across multiple files", () => {
    const result = validateFilePaths(
      ["docs/readme.md", "src/secrets.ts"],
      ["src/"],
      ["src/secrets.ts"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("passes when every file is allowed and none is protected", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  const constraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 3,
    maxDiffLines: 100,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("passes when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], constraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("passes exactly at the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result.valid).toBe(true);
  });

  it("fails and reports the count and max when exceeding the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("reports no matches when the content is clean", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["TODO", "console\\.log"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("detects a single forbidden pattern", () => {
    const result = checkForbiddenPatterns("console.log('hi')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("detects multiple forbidden patterns independently", () => {
    const result = checkForbiddenPatterns("TODO: fix this; console.log('x')", [
      "TODO",
      "console\\.log",
      "FIXME",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO", "console\\.log"]);
  });
});
