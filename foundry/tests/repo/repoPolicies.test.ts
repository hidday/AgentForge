import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], ["secrets/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allow-all", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "other/file.ts" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets/key.ts"], ["src/"], ["src/secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets/key.ts" is in a protected path']);
  });

  it("can report both an unallowed and a protected violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.ts"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  const constraints = { maxFilesChanged: 3 } as Constraints;

  it("is valid at the boundary (exactly the max)", () => {
    const result = validateDiffSize(["a", "b", "c"], constraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags one file over the max", () => {
    const result = validateDiffSize(["a", "b", "c", "d"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });

  it("is valid for an empty changeset", () => {
    const result = validateDiffSize([], constraints);
    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no pattern matches", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every matching pattern", () => {
    const result = checkForbiddenPatterns("eval(x); process.exit(1);", [
      "eval\\(",
      "process\\.exit",
      "nomatch",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid for an empty pattern list", () => {
    const result = checkForbiddenPatterns("anything goes", []);
    expect(result.valid).toBe(true);
  });
});
