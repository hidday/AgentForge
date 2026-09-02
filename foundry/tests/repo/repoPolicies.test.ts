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
    maxFilesChanged: 5,
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

  it("treats an empty allowedPaths list as 'anything is allowed'", () => {
    const result = validateFilePaths(["anywhere/foo.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["other/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/foo.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("can report both violations for the same file", () => {
    const result = validateFilePaths(["other/secrets.ts"], ["src/"], ["other/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "other/secrets.ts" is not in any allowed path',
      'File "other/secrets.ts" is in a protected path',
    ]);
  });

  it("returns valid=true with no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("evaluates each file against multiple allowed/protected path prefixes", () => {
    const result = validateFilePaths(
      ["src/a.ts", "tests/a.test.ts", "docs/readme.md"],
      ["src/", "tests/"],
      ["docs/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "docs/readme.md" is not in any allowed path',
      'File "docs/readme.md" is in a protected path',
    ]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid exactly at the maxFilesChanged boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid one file past the boundary", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid for an empty file list", () => {
    const result = validateDiffSize([], makeConstraints({ maxFilesChanged: 1 }));
    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid (no matches) when content has none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "console\\.log"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("reports each forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns(
      "console.log('hi'); eval('2+2');",
      ["console\\.log", "eval\\("],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "eval\\("]);
  });

  it("supports arbitrary regex patterns, not just literal strings", () => {
    const result = checkForbiddenPatterns("TODO: fix this later", ["TODO:?\\s"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO:?\\s"]);
  });

  it("is valid when forbiddenPatterns is empty", () => {
    const result = checkForbiddenPatterns("anything goes", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("only reports a pattern once even if it matches multiple times", () => {
    const result = checkForbiddenPatterns("console.log(1); console.log(2);", ["console\\.log"]);
    expect(result.matches).toEqual(["console\\.log"]);
  });
});
