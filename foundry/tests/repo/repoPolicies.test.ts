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
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);

    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);

    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("accumulates both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.ts"], ["src/"], ["secrets/"]);

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "secrets/key.ts" is not in any allowed path',
      'File "secrets/key.ts" is in a protected path',
    ]);
  });

  it("returns no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["secrets/"]);

    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));

    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags when the number of changed files exceeds the max", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid at exactly the boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));

    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["TODO", "FIXME"]);

    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns(
      "// TODO: fix this\nconsole.log('debug')",
      ["TODO", "console\\.log"],
    );

    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO", "console\\.log"]);
  });

  it("returns no matches for an empty pattern list", () => {
    const result = checkForbiddenPatterns("anything goes", []);

    expect(result).toEqual({ valid: true, matches: [] });
  });
});
