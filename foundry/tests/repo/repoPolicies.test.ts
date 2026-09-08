import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

describe("validateFilePaths", () => {
  it("is valid when every file is within an allowed path and not protected", () => {
    const result = validateFilePaths(
      ["src/foo.ts", "src/bar/baz.ts"],
      ["src/"],
      [".github/"],
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["scripts/deploy.sh"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "scripts/deploy.sh" is not in any allowed path']);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file that matches a protected path even if also allowed", () => {
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

  it("can report both an unallowed and a protected violation for the same file", () => {
    const result = validateFilePaths(["secrets/keys.pem"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations).toEqual([
      'File "secrets/keys.pem" is not in any allowed path',
      'File "secrets/keys.pem" is in a protected path',
    ]);
  });

  it("returns no violations for an empty file list", () => {
    expect(validateFilePaths([], ["src/"], [".github/"])).toEqual({
      valid: true,
      violations: [],
    });
  });
});

describe("validateDiffSize", () => {
  function constraints(overrides: Partial<Constraints> = {}): Constraints {
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
    const result = validateDiffSize(["a.ts", "b.ts"], constraints());
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid at exactly the limit (boundary)", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts"], constraints());
    expect(result.valid).toBe(true);
  });

  it("flags when the number of files changed exceeds the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts", "c.ts", "d.ts"], constraints());
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 4 files (max: 3)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches no forbidden pattern", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a matching pattern", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("reports every pattern that matches, not just the first", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid for an empty forbiddenPatterns list", () => {
    expect(checkForbiddenPatterns("anything goes", []).valid).toBe(true);
  });
});
