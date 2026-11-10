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

  it("flags a file that is not under any allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file that is under a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("treats an empty allowedPaths list as allowing every path", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secret/file.ts"], ["src/"], ["secret/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        'File "secret/file.ts" is not in any allowed path',
        'File "secret/file.ts" is in a protected path',
      ]),
    );
  });

  it("returns valid for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], ["secret/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary (filesChanged.length === maxFilesChanged)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when filesChanged exceeds maxFilesChanged by one", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a match when content contains a forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every forbidden pattern that matches, in order", () => {
    const result = checkForbiddenPatterns(
      "eval('x'); console.log(process.env.SECRET);",
      ["eval\\(", "process\\.env", "debugger"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env"]);
  });

  it("returns valid when forbiddenPatterns is empty", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
