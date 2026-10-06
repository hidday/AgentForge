import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: ["lint"],
    maxFilesChanged: 5,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when every file is under an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar/baz.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as 'allow everything'", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file under a protected path even if it is also under an allowed path", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("can report both an allowed-path and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.ts"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "secrets/key.ts" is not in any allowed path',
      'File "secrets/key.ts" is in a protected path',
    ]);
  });

  it("accumulates violations across multiple files", () => {
    const result = validateFilePaths(["ok/a.ts", "bad/b.ts", "ok/c.ts"], ["ok/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("bad/b.ts");
  });

  it("returns valid for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], ["secrets/"])).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when the changed file count is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary (count === max)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid one past the boundary (count === max + 1)", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when the content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a pattern that matches the content", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("can report multiple matched patterns", () => {
    const result = checkForbiddenPatterns(
      "eval('x'); process.exit(1);",
      ["eval\\(", "process\\.exit\\("],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit\\("]);
  });

  it("returns valid for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("treats each pattern as a regular expression, not a literal string", () => {
    const result = checkForbiddenPatterns("TODO: fixme", ["TODO:\\s*\\w+"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["TODO:\\s*\\w+"]);
  });
});
