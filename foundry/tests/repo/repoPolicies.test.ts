import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.env"], ["src/"], ["src/secrets.env"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.env" is in a protected path']);
  });

  it("can report both violations for the same file", () => {
    const result = validateFilePaths(["other/secrets.env"], ["src/"], ["other/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
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

  it("is valid when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid exactly at the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when the number of changed files exceeds the limit", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every forbidden pattern that matches", () => {
    const content = "eval(input); process.env.SECRET";
    const result = checkForbiddenPatterns(content, ["eval\\(", "process\\.env"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env"]);
  });

  it("returns no matches for an empty pattern list", () => {
    const result = checkForbiddenPatterns("anything", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
