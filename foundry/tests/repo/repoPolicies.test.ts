import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("allows every file when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/anything.ts", "random/file.txt"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside the allowed paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("accepts a file inside an allowed path prefix", () => {
    const result = validateFilePaths(["src/index.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file inside a protected path even when otherwise allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("reports both violations when a file is unallowed and protected", () => {
    const result = validateFilePaths(["secrets/key.pem"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "secrets/key.pem" is not in any allowed path',
      'File "secrets/key.pem" is in a protected path',
    ]);
  });

  it("evaluates every file independently and collects all violations", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "other/bad.ts", "src/locked.ts"],
      ["src/"],
      ["src/locked.ts"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toContain("other/bad.ts");
    expect(result.violations[1]).toContain("src/locked.ts");
  });

  it("returns valid for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], ["secrets/"])).toEqual({
      valid: true,
      violations: [],
    });
  });
});

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 5,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary", () => {
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
});

describe("checkForbiddenPatterns", () => {
  it("is valid when there are no forbidden patterns", () => {
    const result = checkForbiddenPatterns("some content with TODO", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("is valid when none of the patterns match", () => {
    const result = checkForbiddenPatterns("clean content", ["FIXME", "XXX"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a matching pattern", () => {
    const result = checkForbiddenPatterns("// TODO: fix this later", ["TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO"]);
  });

  it("collects every matching pattern out of several", () => {
    const result = checkForbiddenPatterns(
      "console.log('debug'); // TODO cleanup",
      ["console\\.log", "TODO", "FIXME"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "TODO"]);
  });

  it("supports regex patterns, not just literal substrings", () => {
    const result = checkForbiddenPatterns("API_KEY=sk-12345", ["API_KEY\\s*=\\s*\\S+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["API_KEY\\s*=\\s*\\S+"]);
  });
});
