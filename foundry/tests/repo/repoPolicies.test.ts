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
  it("is valid when all files are within an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/foo.ts", "src/bar.ts"], ["src/"], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags a file not under any allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "docs/readme.md" is not in any allowed path']);
  });

  it("flags a file under a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/secrets.ts"], ["src/"], ["src/secrets.ts"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(['File "src/secrets.ts" is in a protected path']);
  });

  it("treats an empty allowedPaths list as allow-all", () => {
    const result = validateFilePaths(["anything/here.ts"], [], []);
    expect(result.valid).toBe(true);
  });

  it("can report both an unallowed and a protected violation for the same file set", () => {
    const result = validateFilePaths(
      ["outside/file.ts", "src/protected.ts"],
      ["src/"],
      ["src/protected.ts"],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags when the number of changed files exceeds maxFilesChanged", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(["Changed 3 files (max: 2)"]);
  });

  it("is valid at exactly the boundary (equal to maxFilesChanged)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when content matches none of the forbidden patterns", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\(", "process\\.exit"]);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("reports each forbidden pattern that matches", () => {
    const result = checkForbiddenPatterns("eval(x); process.exit(1);", [
      "eval\\(",
      "process\\.exit",
    ]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\(", "process\\.exit"]);
  });

  it("returns valid=true when there are no forbidden patterns to check", () => {
    const result = checkForbiddenPatterns("anything at all", []);
    expect(result.valid).toBe(true);
    expect(result.matches).toEqual([]);
  });
});
