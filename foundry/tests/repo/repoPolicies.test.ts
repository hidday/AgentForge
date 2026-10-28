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
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], ["src/config/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file inside a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/config/env.ts"], ["src/"], ["src/config/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/config/env.ts" is in a protected path']);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("can report both an allowed-path and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/env.ts"], ["src/"], ["secrets/"]);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags too many changed files", () => {
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

  it("reports every forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns(
      'eval("danger"); process.exit(1);',
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });
});
