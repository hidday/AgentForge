import { describe, it, expect } from "vitest";
import {
  validateFilePaths,
  validateDiffSize,
  checkForbiddenPatterns,
} from "../../src/repo/repoPolicies.js";
import type { Constraints } from "../../src/schemas/taskBundle.js";

function makeConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    requiredChecks: ["lint", "test"],
    maxFilesChanged: 5,
    maxDiffLines: 500,
    forbiddenPatterns: [],
    mustNotTouch: [],
    ...overrides,
  };
}

describe("validateFilePaths", () => {
  it("is valid when every file is under an allowed path and none are protected", () => {
    const result = validateFilePaths(["src/a.ts", "src/b.ts"], ["src/"], [".github/"]);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("flags a file that is not under any allowed path", () => {
    const result = validateFilePaths(["docs/readme.md"], ["src/"], []);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "docs/readme.md" is not in any allowed path',
    ]);
  });

  it("flags a file that is under a protected path even if also allowed", () => {
    const result = validateFilePaths(["src/.github/workflows/ci.yml"], ["src/"], ["src/.github/"]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      'File "src/.github/workflows/ci.yml" is in a protected path',
    ]);
  });

  it("treats an empty allowedPaths list as allowing everything", () => {
    const result = validateFilePaths(["anywhere/file.ts"], [], []);
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("can report multiple violations across multiple files", () => {
    const result = validateFilePaths(
      ["docs/readme.md", "infra/prod.tf"],
      ["src/"],
      ["infra/"],
    );
    expect(result.valid).toBe(false);
    // "docs/readme.md" is not allowed (1); "infra/prod.tf" is both not allowed
    // under "src/" and protected under "infra/" (2) -- three violations total.
    expect(result.violations).toHaveLength(3);
  });
});

describe("validateDiffSize", () => {
  it("is valid when the number of changed files is within the limit", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 5 }));
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("is invalid when the number of changed files exceeds the limit", () => {
    const result = validateDiffSize(
      ["a.ts", "b.ts", "c.ts"],
      makeConstraints({ maxFilesChanged: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain("Changed 3 files (max: 2)");
  });

  it("is valid at exactly the limit (boundary)", () => {
    const result = validateDiffSize(["a.ts", "b.ts"], makeConstraints({ maxFilesChanged: 2 }));
    expect(result.valid).toBe(true);
  });
});

describe("checkForbiddenPatterns", () => {
  it("is valid when no forbidden pattern matches the content", () => {
    const result = checkForbiddenPatterns("const x = 1;", ["eval\\("]);
    expect(result).toEqual({ valid: true, matches: [] });
  });

  it("reports a match when a forbidden pattern is found", () => {
    const result = checkForbiddenPatterns("eval(userInput)", ["eval\\("]);
    expect(result.valid).toBe(false);
    expect(result.matches).toEqual(["eval\\("]);
  });

  it("checks all patterns and can report multiple matches", () => {
    const result = checkForbiddenPatterns(
      "eval(x); process.env.SECRET_KEY",
      ["eval\\(", "SECRET_KEY"],
    );
    expect(result.matches).toEqual(["eval\\(", "SECRET_KEY"]);
  });

  it("supports regex patterns, not just literal substrings", () => {
    const result = checkForbiddenPatterns("DROP TABLE users;", ["DROP\\s+TABLE"]);
    expect(result.valid).toBe(false);
  });
});
