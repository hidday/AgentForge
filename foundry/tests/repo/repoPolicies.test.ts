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
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing any path", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside all allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("not in any allowed path");
  });

  it("flags a file inside a protected path even if it's also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("protected path");
  });

  it("can produce two violations for a single file that is both disallowed and protected", () => {
    const result = validateFilePaths(["other/secret.ts"], ["src/"], ["other/"]);
    expect(result.violations).toHaveLength(2);
  });

  it("is valid for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of files changed is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid exactly at the boundary (equal to max)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid one file over the max", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("Changed 3 files");
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when none of the forbidden patterns match", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("can match multiple forbidden patterns independently", () => {
    const result = checkForbiddenPatterns(
      "console.log('x'); debugger;",
      ["console\\.log", "debugger"],
    );
    expect(result.matches).toEqual(["console\\.log", "debugger"]);
  });

  it("is valid for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
