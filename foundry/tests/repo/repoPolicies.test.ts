import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none is protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allow-all", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "other/file.ts" is not in any allowed path`]);
  });

  it("flags a file under a protected path even if it is also allowed", () => {
    const result = validateFilePaths(
      ["src/generated/client.ts"],
      ["src/"],
      ["src/generated/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      `File "src/generated/client.ts" is in a protected path`,
    ]);
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
    maxDiffLines: 100,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when the number of changed files is within the limit", () => {
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
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches the content", () => {
    const result = checkForbiddenPatterns("clean content", ["TODO", "FIXME"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports each forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns("// TODO: fix this FIXME later", ["TODO", "FIXME"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO", "FIXME"]);
  });

  it("supports regex patterns, not just literal strings", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log\\("]);
  });
});
