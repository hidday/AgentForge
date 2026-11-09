import { describe, it, expect } from "vitest";
import { validateFilePaths, validateDiffSize, checkForbiddenPatterns } from "../../src/repo/repoPolicies.js";
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

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["lib/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "lib/foo.ts" is not in any allowed path']);
  });

  it("flags a file that matches a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("treats an empty allowedPaths list as 'allow everything'", () => {
    const result = validateFilePaths(["anywhere/foo.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.pem"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("returns valid for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid at exactly the maxFilesChanged boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when filesChanged exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when the content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["TODO", "FIXME"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("reports every forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns("// TODO: fix this\n// FIXME later", ["TODO", "FIXME"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO", "FIXME"]);
  });

  it("supports regex patterns, not just literal substrings", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log\\("]);
  });

  it("is valid when forbiddenPatterns is empty", () => {
    const result = checkForbiddenPatterns("anything goes", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
