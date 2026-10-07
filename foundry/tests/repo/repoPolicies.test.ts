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
  it("is valid with no violations when there are no files changed", () => {
    expect(validateFilePaths([], ["src/"], ["secrets/"])).toEqual({
      valid: true,
      violations: [],
    });
  });

  it("allows any path when allowedPaths is empty", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("allows a file that starts with an allowed path prefix", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file that matches none of the non-empty allowed paths", () => {
    const result = validateFilePaths(["outside/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "outside/foo.ts" is not in any allowed path']);
  });

  it("flags a file that matches a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("reports both violations when a file is neither allowed nor is protected-matched", () => {
    const result = validateFilePaths(["other/secrets/key.ts"], ["src/"], ["other/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "other/secrets/key.ts" is not in any allowed path',
      'File "other/secrets/key.ts" is in a protected path',
    ]);
  });

  it("evaluates every file independently, mixing valid and invalid entries", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "docs/bad.md", "src/secrets/token.ts"],
      ["src/"],
      ["src/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "docs/bad.md" is not in any allowed path',
      'File "src/secrets/token.ts" is in a protected path',
    ]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of files changed is below the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 10 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid exactly at the max boundary (not a violation)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid one file past the max boundary", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid for zero files changed regardless of the limit", () => {
    const result = validateDiffSize([], makeConstraints({ maxFilesChanged: 1 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid with no matches when there are no forbidden patterns", () => {
    expect(checkForbiddenPatterns("some content", [])).toEqual({ valid: true, matches: [] });
  });

  it("is valid when the content does not match any forbidden pattern", () => {
    const result = checkForbiddenPatterns("clean content", ["TODO", "FIXME"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a pattern that matches as a plain substring", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("flags only the patterns that actually match, preserving input order", () => {
    const result = checkForbiddenPatterns("has FIXME but not the other one", [
      "TODO",
      "FIXME",
      "XXX",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["FIXME"]);
  });

  it("treats forbidden patterns as regular expressions", () => {
    const result = checkForbiddenPatterns("api_key = 12345", ["api_key\\s*=\\s*\\d+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["api_key\\s*=\\s*\\d+"]);
  });

  it("does not throw and does not match across repeated calls due to regex statefulness", () => {
    // Each pattern creates its own RegExp with the "g" flag; verify two
    // consecutive identical contents both detect the match rather than the
    // second call silently skipping due to lastIndex carrying over.
    const patterns = ["foo"];
    const first = checkForbiddenPatterns("foo bar", patterns);
    const second = checkForbiddenPatterns("foo bar", patterns);
    expect(first.matches).toEqual(["foo"]);
    expect(second.matches).toEqual(["foo"]);
  });
});
