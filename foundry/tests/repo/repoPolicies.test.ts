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
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file that falls under a protected path even if it's also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["danger/secrets.ts"], ["src/"], ["danger/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('File "danger/secrets.ts" is not in any allowed path');
    expect(result.violations).toContain('File "danger/secrets.ts" is in a protected path');
  });

  it("returns valid: true with no violations for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["danger/"]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid at exactly the max boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags a violation when the number of changed files exceeds the max", () => {
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
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("flags a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("can report multiple matching patterns", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.env.SECRET",
      ["eval\\(", "process\\.env\\.SECRET"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env\\.SECRET"]);
  });

  it("returns valid: true with an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
