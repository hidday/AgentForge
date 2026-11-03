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
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], [".github/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats every file as allowed when allowedPaths is empty", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file under a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/prisma/migrations/x.sql"], ["src/"], [
      "src/prisma/migrations/",
    ]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "src/prisma/migrations/x.sql" is in a protected path',
    ]);
  });

  it("can report both an unallowed and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["infra/secrets.yaml"], ["src/"], ["infra/"]);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toContain("not in any allowed path");
    expect(result.violations[1]).toContain("protected path");
  });

  it("returns valid for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], [])).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("is invalid when filesChanged exceeds the limit", () => {
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

  it("reports a matching forbidden pattern", () => {
    const result = checkForbiddenPatterns("console.log('debug')", ["console\\.log"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["console\\.log"]);
  });

  it("reports multiple matching patterns", () => {
    const result = checkForbiddenPatterns("eval(x); console.log(x);", [
      "eval\\(",
      "console\\.log",
    ]);
    expect(result.matches).toEqual(["eval\\(", "console\\.log"]);
  });

  it("returns valid with no patterns to check", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
