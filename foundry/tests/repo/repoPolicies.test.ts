import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "src/bar/baz.ts"],
      ["src/"],
      [".github/"],
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allow-all", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file that is not under any allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file that falls under a protected path even if also allowed", () => {
    const result = validateFilePaths(
      ["src/.github/workflows/ci.yml"],
      ["src/"],
      ["src/.github/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "src/.github/workflows/ci.yml" is in a protected path',
    ]);
  });

  it("can report both an unallowed and a protected violation for different files in one call", () => {
    const result = validateFilePaths(
      ["docs/readme.md", "prisma/migrations/x.sql"],
      ["src/"],
      ["prisma/migrations/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain('File "docs/readme.md" is not in any allowed path');
    expect(result.violations).toContain(
      'File "prisma/migrations/x.sql" is in a protected path',
    );
  });

  it("returns valid for an empty file list", () => {
    const result = validateFilePaths([], ["src/"], ["prisma/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
    return {
      requiredChecks: [],
      maxFilesChanged: 5,
      maxDiffLines: 200,
      forbiddenPatterns: [],
      mustNotTouch: [],
      ...overrides,
    };
  }

  it("is valid when the number of changed files is at or under the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags when the number of changed files exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid exactly at the boundary (equal to maxFilesChanged)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a pattern that matches the content", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every forbidden pattern that matches, not just the first", () => {
    const content = "eval('x'); process.exit(1);";
    const result = checkForbiddenPatterns(content, ["eval\\(", "process\\.exit\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit\\("]);
  });

  it("returns valid for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
