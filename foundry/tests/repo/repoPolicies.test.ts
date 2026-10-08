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
  it("is valid when every file is under an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("flags a file outside every allowed path", () => {
    const result = validateFilePaths(["other/file.ts"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "other/file.ts" is not in any allowed path`]);
  });

  it("flags a file under a protected path even if it is also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([`File "src/secrets.ts" is in a protected path`]);
  });

  it("can report both an unallowed-path and a protected-path violation for the same file", () => {
    const result = validateFilePaths(["secrets/key.pem"], ["src/"], ["secrets/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the file count is within the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is valid when the file count exactly equals the max", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });

  it("flags when the file count exceeds the max", () => {
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
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("can report multiple matching patterns", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.exit(1);",
      ["eval\\(", "process\\.exit"],
    );
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });
});
