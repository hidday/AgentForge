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
    maxFilesChanged: 10,
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

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "docs/readme.md" is not in any allowed path`]);
  });

  it("flags a file inside a protected path even if also allowed", () => {
    const result = validateFilePaths([".github/workflows/ci.yml"], ["./"], [".github/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      `File ".github/workflows/ci.yml" is in a protected path`,
    );
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anything/at/all.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("can report both an allowed-path violation and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/.github/x.yml"], ["src/"], [".github/"]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("not in any allowed path");
  });
});

describe("validateDiffSize", () => {
  it("is valid when filesChanged is within maxFilesChanged", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags when filesChanged exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports every forbidden pattern that matches, as regexes", () => {
    const result = checkForbiddenPatterns(
      "eval('danger'); process.env.SECRET",
      ["eval\\(", "process\\.env\\.SECRET"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.env\\.SECRET"]);
  });

  it("returns valid with no patterns configured", () => {
    const result = checkForbiddenPatterns("anything goes", []);
    expect(result).toEqual({ valid: true, matches: [] });
  });
});
