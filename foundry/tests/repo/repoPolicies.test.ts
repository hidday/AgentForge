import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when allowedPaths is empty (no allow-list restriction)", () => {
    const result = validateFilePaths(["src/foo.ts", "anywhere/bar.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file that does not start with any allowed path", () => {
    const result = validateFilePaths(["src/foo.ts", "other/bar.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/bar.ts" is not in any allowed path']);
  });

  it("allows a file that matches at least one allowed path prefix", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/", "lib/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file under a protected path even when it is also allowed", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("can report both an allow-list violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.ts"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "secrets/key.ts" is not in any allowed path',
      'File "secrets/key.ts" is in a protected path',
    ]);
  });

  it("collects violations across multiple files", () => {
    const result = validateFilePaths(["src/ok.ts", "bad/one.ts", "bad/two.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("is valid for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], ["secrets/"])).toEqual({
      valid: true,
      violations: [],
    });
  });
});

describe("validateDiffSize", () => {
  const baseConstraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 3,
    maxDiffLines: 100,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when the number of changed files is under the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], baseConstraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the limit (boundary)", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], baseConstraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a diff that exceeds the limit by one", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], baseConstraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });

  it("flags a diff that exceeds the limit by many", () => {
    const files = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
    const result = validateDiffSize(files, baseConstraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 10 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log", "debugger"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a single matching pattern", () => {
    const result = checkForbiddenPatterns("console.log('hi')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("flags multiple matching patterns while skipping non-matching ones", () => {
    const content = "console.log('x'); debugger;";
    const result = checkForbiddenPatterns(content, ["console\\.log", "TODO", "debugger"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "debugger"]);
  });

  it("is valid for an empty forbidden-pattern list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("matches using regex semantics, not plain substring", () => {
    const result = checkForbiddenPatterns("foobar123", ["foo.*123"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["foo.*123"]);
  });
});
