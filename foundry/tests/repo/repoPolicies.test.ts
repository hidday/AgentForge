import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("passes when all files are within an allowed path and none are protected", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "src/bar.ts"],
      ["src/"],
      [".github/"],
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if also allowed", () => {
    const result = validateFilePaths(
      [".github/workflows/ci.yml"],
      [".github/"],
      [".github/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File ".github/workflows/ci.yml" is in a protected path',
    ]);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.pem"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        'File "secrets/key.pem" is not in any allowed path',
        'File "secrets/key.pem" is in a protected path',
      ]),
    );
  });

  it("treats an empty allowedPaths array as allow-all", () => {
    const result = validateFilePaths(["anything/anywhere.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("treats an empty filesChanged array as trivially valid", () => {
    const result = validateFilePaths([], ["src/"], [".github/"]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
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
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes when the number of changed files exactly equals the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result.valid).toBe(true);
  });

  it("fails when the number of changed files exceeds the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("passes when content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log", "debugger"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("flags a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("console.log('hi')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("can flag multiple matching patterns", () => {
    const result = checkForbiddenPatterns(
      "debugger; console.log('x');",
      ["console\\.log", "debugger"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "debugger"]);
  });

  it("treats an empty forbiddenPatterns array as trivially valid", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
