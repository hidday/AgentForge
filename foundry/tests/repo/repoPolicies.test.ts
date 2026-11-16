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
  it("allows everything when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/anything.ts", "docs/readme.md"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a protected path as a violation even if it is also within an allowed path", () => {
    const result = validateFilePaths(
      ["src/secrets/key.ts"],
      ["src/"],
      ["src/secrets/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("flags a non-allowed path as a violation", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("produces no violations for a file that is allowed and not protected", () => {
    const result = validateFilePaths(["src/index.ts"], ["src/"], ["src/secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid exactly at the maxFilesChanged boundary", () => {
    const constraints = makeConstraints({ maxFilesChanged: 3 });
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is a violation one file over the boundary", () => {
    const constraints = makeConstraints({ maxFilesChanged: 3 });
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["console\\.log"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a match when a forbidden pattern is found", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("reports all matching patterns among several", () => {
    const result = checkForbiddenPatterns(
      "console.log('x'); eval('y'); const z = 1;",
      ["console\\.log", "eval\\(", "debugger"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log", "eval\\("]);
  });
});
