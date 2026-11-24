import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar/baz.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allow-all", () => {
    const result = validateFilePaths(["anywhere/foo.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/foo.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["File \"other/foo.ts\" is not in any allowed path"]);
  });

  it("flags a file under a protected path even if it's also allowed", () => {
    const result = validateFilePaths(["src/generated/x.ts"], ["src/"], ["src/generated/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["File \"src/generated/x.ts\" is in a protected path"]);
  });

  it("accumulates violations for multiple bad files", () => {
    const result = validateFilePaths(
      ["other/foo.ts", "src/generated/x.ts"],
      ["src/"],
      ["src/generated/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  const constraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 2,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when under the max files changed", () => {
    expect(validateDiffSize(["a.ts"], constraints)).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when exceeding the max files changed", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints);
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("Changed 3 files");
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns("eval('x'); console.log(process.env.SECRET)", [
      "eval\\(",
      "process\\.env",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env"]);
  });
});
