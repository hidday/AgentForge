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

describe("validateFilePaths()", () => {
  it("treats every file as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/anything.ts", "docs/readme.md"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("allows files that start with one of the allowed path prefixes", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "src/bar/baz.ts"],
      ["src/"],
      [],
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file that does not start with any allowed path prefix", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file that is under a protected path even if it is otherwise allowed", () => {
    const result = validateFilePaths(
      ["src/secrets/keys.ts"],
      ["src/"],
      ["src/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/keys.ts" is in a protected path']);
  });

  it("produces both violations for a file that is neither allowed nor is protected-path-matched", () => {
    const result = validateFilePaths(
      ["forbidden/secrets/x.ts"],
      ["src/"],
      ["forbidden/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "forbidden/secrets/x.ts" is not in any allowed path',
      'File "forbidden/secrets/x.ts" is in a protected path',
    ]);
  });

  it("returns valid:true with no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["src/secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("aggregates violations across multiple files", () => {
    const result = validateFilePaths(
      ["src/ok.ts", "other/bad.ts", "src/secrets/oops.ts"],
      ["src/"],
      ["src/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('File "other/bad.ts" is not in any allowed path');
    expect(result.violations).toContain('File "src/secrets/oops.ts" is in a protected path');
  });
});

describe("validateDiffSize()", () => {
  it("is valid when the number of changed files is under the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid when the number of changed files exactly equals the max (boundary)", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 3 }),
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when the number of changed files exceeds the max", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts", "d.ts"],
      makeConstraints({ maxFilesChanged: 3 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns()", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("clean content here", ["FIXME", "console\\.log"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("returns valid:true with empty matches when there are no forbidden patterns to check", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a single matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("// TODO: fix this later", ["TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO"]);
  });

  it("flags every forbidden pattern that matches, preserving input order", () => {
    const content = "console.log('debug'); // TODO: remove\nprocess.env.SECRET";
    const result = checkForbiddenPatterns(content, [
      "TODO",
      "console\\.log",
      "process\\.env\\.SECRET",
      "not-present-anywhere",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO", "console\\.log", "process\\.env\\.SECRET"]);
  });

  it("supports regex patterns, not just literal substrings", () => {
    const result = checkForbiddenPatterns("api_key = 'sk-12345'", ["api[_-]?key\\s*="]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["api[_-]?key\\s*="]);
  });
});
