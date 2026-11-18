import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("passes all files when allowedPaths is empty (no restriction) and nothing is protected", () => {
    const result = validateFilePaths(["src/foo.ts", "README.md"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags files outside the allowed paths", () => {
    const result = validateFilePaths(["docs/notes.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/notes.md" is not in any allowed path']);
  });

  it("flags files inside a protected path even if also allowed", () => {
    const result = validateFilePaths(
      ["src/migrations/001.sql"],
      ["src/"],
      ["src/migrations/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "src/migrations/001.sql" is in a protected path',
    ]);
  });

  it("can report both an unallowed and a protected violation for the same file", () => {
    const result = validateFilePaths(
      ["infra/secrets.yaml"],
      ["src/"],
      ["infra/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toContain(
      'File "infra/secrets.yaml" is not in any allowed path',
    );
    expect(result.violations).toContain(
      'File "infra/secrets.yaml" is in a protected path',
    );
  });

  it("is valid when all files are within allowed paths and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], ["infra/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("returns valid for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], [])).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
    return {
      requiredChecks: [],
      maxFilesChanged: 3,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
      ...overrides,
    };
  }

  it("is valid when the number of files changed is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints());
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid when exactly at the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], makeConstraints());
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a violation when more files changed than the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], makeConstraints());
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden patterns are matched", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a matched forbidden pattern", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("can flag multiple matched patterns", () => {
    const result = checkForbiddenPatterns(
      "eval('x'); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid for an empty pattern list", () => {
    const result = checkForbiddenPatterns("anything goes here", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
