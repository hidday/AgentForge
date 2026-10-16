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
  it("allows everything when allowedPaths is empty, with no protected paths", () => {
    const result = validateFilePaths(["anything/at/all.ts", "root.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside the allowed paths when allowedPaths is non-empty", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("passes a file that matches an allowed path prefix", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file under a protected path even when allowedPaths is empty (everything allowed)", () => {
    const result = validateFilePaths(["secrets/key.pem"], [], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "secrets/key.pem" is in a protected path']);
  });

  it("accumulates two violations for a file that is both outside allowedPaths and under a protectedPath", () => {
    const result = validateFilePaths(["secrets/key.pem"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "secrets/key.pem" is not in any allowed path',
      'File "secrets/key.pem" is in a protected path',
    ]);
  });

  it("is fine when a file is allowed and not protected (0 violations for that file)", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], ["secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("evaluates allowed-path and protected-path checks independently across multiple files", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "other/bar.ts", "src/secrets/leak.ts"],
      ["src/"],
      ["src/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "other/bar.ts" is not in any allowed path',
      'File "src/secrets/leak.ts" is in a protected path',
    ]);
  });

  it("returns valid:true and no violations for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], ["secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("passes when filesChanged is exactly at maxFilesChanged (boundary)", () => {
    const constraints = makeConstraints({ maxFilesChanged: 3 });
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("fails when filesChanged is one over maxFilesChanged", () => {
    const constraints = makeConstraints({ maxFilesChanged: 3 });
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });

  it("passes when well under the limit", () => {
    const constraints = makeConstraints({ maxFilesChanged: 10 });
    const result = validateDiffSize(["a.ts"], constraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("returns valid:true with no matches when no patterns are given", () => {
    const result = checkForbiddenPatterns("some content here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("returns valid:true with no matches when the pattern does not match", () => {
    const result = checkForbiddenPatterns("clean content", ["TODO_SECRET"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a pattern that matches once in the content", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("flags only the matching patterns among multiple, leaving non-matching ones out", () => {
    const result = checkForbiddenPatterns("API_KEY=abc123", [
      "API_KEY",
      "PRIVATE_KEY",
      "abc123",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["API_KEY", "abc123"]);
  });

  it("records a pattern only once even when it matches the content multiple times (no stateful lastIndex bug)", () => {
    const content = "console.log(1); console.log(2); console.log(3);";
    const result = checkForbiddenPatterns(content, ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
    expect(result.matches).toHaveLength(1);
  });

  it("evaluates the same pattern correctly even when checked against content where it appears twice back-to-back", () => {
    const content = "foofoo bar";
    const result = checkForbiddenPatterns(content, ["foo"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["foo"]);
  });
});
