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
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], [".github/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anything/here.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(
      ["src/migrations/001.sql"],
      ["src/"],
      ["src/migrations/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/migrations/001.sql" is in a protected path']);
  });

  it("can report both an allowed-path and protected-path violation for the same file", () => {
    const result = validateFilePaths(["infra/secrets.yml"], ["src/"], ["infra/"]);
    expect(result.violations).toHaveLength(2);
  });

  it("returns no violations for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], ["infra/"])).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of files changed is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the max boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when the number of files changed exceeds the max", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when the content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports each forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns(
      "eval(userInput); console.log(x); process.env.SECRET",
      ["eval\\(", "process\\.env\\."],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env\\."]);
  });

  it("returns valid:true for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
