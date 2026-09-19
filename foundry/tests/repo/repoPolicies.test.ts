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
    maxFilesChanged: 10,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when all files are within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["scripts/deploy.sh"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "scripts/deploy.sh" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("treats an empty allowedPaths list as 'allow everything'", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths([".github/workflows/ci.yml"], ["src/"], [".github/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        'File ".github/workflows/ci.yml" is not in any allowed path',
        'File ".github/workflows/ci.yml" is in a protected path',
      ]),
    );
  });

  it("aggregates violations across multiple files", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "scripts/bad.sh", "prisma/migrations/x.sql"],
      ["src/"],
      ["prisma/migrations/"],
    );
    expect(result.valid).toBe(false);
    // "scripts/bad.sh" -> not allowed (1); "prisma/migrations/x.sql" -> not
    // allowed AND protected (2); "src/ok.ts" contributes none.
    expect(result.violations).toHaveLength(3);
  });

  it("returns valid for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["prisma/"]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid at exactly the maxFilesChanged boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when the number of changed files exceeds the limit", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("reports a match when content contains a forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every forbidden pattern that matches, not just the first", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid when there are no forbidden patterns configured", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
