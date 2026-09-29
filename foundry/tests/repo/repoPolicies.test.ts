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
      ["src/generated/"],
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["lib/outside.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "lib/outside.ts" is not in any allowed path`]);
  });

  it("flags a file that is within a protected path even if also allowed", () => {
    const result = validateFilePaths(
      ["src/generated/client.ts"],
      ["src/"],
      ["src/generated/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      `File "src/generated/client.ts" is in a protected path`,
    ]);
  });

  it("collects both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(
      ["forbidden/secrets.env"],
      ["src/"],
      ["forbidden/"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      `File "forbidden/secrets.env" is not in any allowed path`,
      `File "forbidden/secrets.env" is in a protected path`,
    ]);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("returns valid for an empty filesChanged list", () => {
    const result = validateFilePaths([], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });
});

describe("validateDiffSize", () => {
  const baseConstraints: Constraints = {
    requiredChecks: [],
    maxFilesChanged: 3,
    maxDiffLines: 100,
    forbiddenPatterns: [],
    mustNotTouch: [],
  };

  it("is valid when the number of files changed is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], baseConstraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the maxFilesChanged boundary", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], baseConstraints);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags when the number of files changed exceeds the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], baseConstraints);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("flags a single matching pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("collects every pattern that matches", () => {
    const content = "eval(x); process.exit(1);";
    const result = checkForbiddenPatterns(content, ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid for an empty forbiddenPatterns list", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
