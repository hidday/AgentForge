import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("allows everything when allowedPaths is empty", () => {
    const result = validateFilePaths(["src/anywhere.ts", "random/file.md"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file that matches neither allowed nor protected paths", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("passes a file that matches an allowed path", () => {
    const result = validateFilePaths(["src/index.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file matching a protected path even if also allowed", () => {
    const result = validateFilePaths(
      ["src/migrations/001.sql"],
      ["src/"],
      ["src/migrations/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/migrations/001.sql" is in a protected path']);
  });

  it("flags a file that is both not allowed and protected with both violations", () => {
    const result = validateFilePaths(
      ["infra/secrets.yaml"],
      ["src/"],
      ["infra/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "infra/secrets.yaml" is not in any allowed path',
      'File "infra/secrets.yaml" is in a protected path',
    ]);
  });

  it("handles multiple files, mixing valid and invalid", () => {
    const result = validateFilePaths(
      ["src/a.ts", "docs/readme.md"],
      ["src/"],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("returns valid for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], ["infra/"]);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("validateDiffSize", () => {
  const baseConstraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 5,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when file count is exactly at the max", () => {
    const files = Array.from({ length: 5 }, (_, i) => `src/file${i}.ts`);
    const result = validateDiffSize(files, baseConstraints);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is invalid when file count exceeds the max", () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/file${i}.ts`);
    const result = validateDiffSize(files, baseConstraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 6 files (max: 5)"]);
  });

  it("is valid when well under the max", () => {
    const result = validateDiffSize(["src/a.ts"], baseConstraints);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("is valid for an empty file list", () => {
    const result = validateDiffSize([], baseConstraints);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("reports no matches when content does not match any pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("reports a match when a forbidden pattern is found", () => {
    const result = checkForbiddenPatterns("eval('danger')", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports multiple matches when several patterns match", () => {
    const content = "eval('x'); process.exit(1);";
    const result = checkForbiddenPatterns(content, ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
