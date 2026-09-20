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
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside of every allowed path", () => {
    const result = validateFilePaths(["scripts/deploy.sh"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "scripts/deploy.sh" is not in any allowed path']);
  });

  it("flags a file that falls under a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/migrations/001.sql"], ["src/"], ["src/migrations/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/migrations/001.sql" is in a protected path']);
  });

  it("reports both violations for a file that is neither allowed nor unprotected", () => {
    const result = validateFilePaths(["secrets/keys.env"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('File "secrets/keys.env" is not in any allowed path');
    expect(result.violations).toContain('File "secrets/keys.env" is in a protected path');
  });

  it("handles an empty file list as valid with no violations", () => {
    const result = validateFilePaths([], ["src/"], ["secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("accumulates violations across multiple offending files", () => {
    const result = validateFilePaths(
      ["outside/a.ts", "outside/b.ts"],
      ["src/"],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is at the max threshold", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when the number of changed files exceeds the max threshold", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid for an empty changed-files list", () => {
    const result = validateDiffSize([], makeConstraints({ maxFilesChanged: 0 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a pattern that matches the content", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every forbidden pattern that matches, not just the first", () => {
    const content = "eval(x); process.exit(1);";
    const result = checkForbiddenPatterns(content, ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid for an empty forbidden-patterns list regardless of content", () => {
    const result = checkForbiddenPatterns("eval(anything)", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("supports regex patterns, not just literal substrings", () => {
    const result = checkForbiddenPatterns("api_key = 'sk-12345'", ["sk-[0-9]+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["sk-[0-9]+"]);
  });
});
