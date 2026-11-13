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
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/foo.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside of every allowed path", () => {
    const result = validateFilePaths(["other/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/foo.ts" is not in any allowed path']);
  });

  it("flags a file that is inside a protected path even if it's also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('File "src/secrets.ts" is in a protected path');
  });

  it("can report both violations for the same file", () => {
    const result = validateFilePaths(["protected/secrets.ts"], ["src/"], ["protected/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain(
      'File "protected/secrets.ts" is not in any allowed path',
    );
    expect(result.violations).toContain('File "protected/secrets.ts" is in a protected path');
  });

  it("returns valid for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], ["protected/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged count is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid when the count exactly equals maxFilesChanged (boundary)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags a violation when filesChanged count exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a match when content contains a forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("can report multiple matched patterns", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid when forbiddenPatterns is empty", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
