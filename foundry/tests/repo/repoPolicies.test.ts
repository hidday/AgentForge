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
  it("has no violations for a file inside an allowed path", () => {
    const result = validateFilePaths(["src/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file that doesn't match any allowed path", () => {
    const result = validateFilePaths(["lib/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "lib/foo.ts" is not in any allowed path`]);
  });

  it("treats an empty allowedPaths array as allow-everything", () => {
    const result = validateFilePaths(["anywhere/foo.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file inside a protected path", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "src/secrets/key.ts" is in a protected path`]);
  });

  it("flags a file that is BOTH not-allowed and protected with both violation messages", () => {
    const result = validateFilePaths(["secrets/key.ts"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain(`File "secrets/key.ts" is not in any allowed path`);
    expect(result.violations).toContain(`File "secrets/key.ts" is in a protected path`);
    expect(result.violations.length).toBe(2);
  });

  it("is valid when there are no files changed", () => {
    const result = validateFilePaths([], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when exactly at the maxFilesChanged boundary", () => {
    const constraints = makeConstraints({ maxFilesChanged: 3 });
    const files = ["a.ts", "b.ts", "c.ts"];
    const result = validateDiffSize(files, constraints);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is invalid when one over the maxFilesChanged boundary", () => {
    const constraints = makeConstraints({ maxFilesChanged: 3 });
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"];
    const result = validateDiffSize(files, constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`Changed 4 files (max: 3)`]);
  });

  it("is valid when well under the boundary", () => {
    const constraints = makeConstraints({ maxFilesChanged: 10 });
    const result = validateDiffSize(["a.ts"], constraints);
    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("collects a matching pattern", () => {
    const result = checkForbiddenPatterns("this has a TODO in it", ["TODO"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO"]);
  });

  it("collects only matching patterns among several", () => {
    const result = checkForbiddenPatterns("call eval(x) here", ["TODO", "eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("is valid with empty matches when no patterns are configured", () => {
    const result = checkForbiddenPatterns("arbitrary content", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("is valid with empty matches when patterns are configured but none match", () => {
    const result = checkForbiddenPatterns("clean content", ["FIXME", "XXX"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
